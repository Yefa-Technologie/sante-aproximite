"""Build the georeferenced rescue-map background from the OCHA COD-AB download.

Requires Shapely. Input: extracted civ_admin1/2/3.geojson from the dataset
linked in frontend/public/maps/README.md. No operational zone is created.
"""
import argparse
import json
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

COLORS = {'CI03': '#c6e9af', 'CI04': '#fefee4', 'CI05': '#c6e9af', 'CI06': '#d5e5ff', 'CI07': '#fefee4', 'CI08': '#ffe6d5', 'CI09': '#ffe6d5', 'CI01': '#ffd5d5', 'CI02': '#ffd5d5', 'CI10': '#ffe6d5', 'CI11': '#ffe6d5', 'CI12': '#ffe6d5', 'CI13': '#fefee4', 'CI14': '#fefee4', 'CI15': '#fefee4', 'CI16': '#fefee4', 'CI17': '#d5e5ff', 'CI18': '#d5e5ff', 'CI19': '#c6e9af', 'CI20': '#d5e5ff', 'CI21': '#d5e5ff', 'CI22': '#d5e5ff', 'CI23': '#c6e9af', 'CI24': '#ffe6d5', 'CI25': '#fefee4', 'CI27': '#ffe6d5', 'CI26': '#c6e9af', 'CI28': '#ffe6d5', 'CI29': '#fefee4', 'CI30': '#c6e9af', 'CI31': '#c6e9af', 'CI32': '#c6e9af', 'CI33': '#ffe6d5'}


def build(source, output):
    def load(name):
        return json.loads((source / f"{name}.geojson").read_text(encoding="utf-8"))["features"]

    regions = load("civ_admin1")
    departments = load("civ_admin2")
    subprefectures = load("civ_admin3")
    old = next(f for f in departments if f["properties"]["adm2_name"] == "Daoukro")
    old_geometry = shape(old["geometry"])
    parts = [f for f in subprefectures if f["properties"]["adm2_name"] == "Daoukro"]
    selected = [f for f in parts if f["properties"]["adm3_name"] in {"Ouellé", "Ananda", "Akpassanou"}]
    assert len(parts) == 7 and len(selected) == 3, "Unexpected source hierarchy"
    ouelle = unary_union([shape(f["geometry"]) for f in selected])
    daoukro = unary_union([shape(f["geometry"]) for f in parts if f not in selected])
    assert ouelle.intersection(daoukro).area < 1e-10, "Overlapping departments"
    assert unary_union([ouelle, daoukro]).symmetric_difference(old_geometry).area < 1e-7, "Coverage changed"
    old["geometry"] = mapping(daoukro)
    new = json.loads(json.dumps(old))
    new["properties"].update(adm2_name="Ouellé", adm2_pcode="CI17-OUELLE-2020",
        derived_from="Ouellé, Ananda, Akpassanou; Conseil des ministres 2020-09-23")
    new["geometry"] = mapping(ouelle)
    departments.append(new)

    def feature(item, level):
        p = item["properties"]
        geometry = shape(item["geometry"])
        label = geometry.representative_point()
        simplified = geometry.simplify(.001, preserve_topology=True)
        assert simplified.is_valid and not simplified.is_empty
        return {"type": "Feature", "properties": {
            "shapeID": p[f"adm{level}_pcode"], "shapeName": p[f"adm{level}_name"],
            "regionId": p["adm1_pcode"], "regionName": p["adm1_name"],
            "fill": COLORS[p["adm1_pcode"]], "label": [round(label.x, 6), round(label.y, 6)],
            "derived": p.get("derived_from")}, "geometry": mapping(simplified)}

    data = {
        "regions": [feature(f, 1) for f in regions],
        "departments": [feature(f, 2) for f in departments],
        "source": "CNTIG / OCHA ROWCA, COD-AB 2018; Ouellé: reconstitution des sous-préfectures selon le communiqué du 23 septembre 2020",
        "license": "CC BY 3.0 IGO",
        "sourceUrl": "https://data.humdata.org/dataset/cod-ab-civ",
        "ouelleSource": "https://www.presidence.ci/wp-content/uploads/2020/09/CCM-du-23-09-2020.pdf"}
    assert len(data["regions"]) == 33 and len(data["departments"]) == 109
    assert len({f["properties"]["shapeID"] for f in data["departments"]}) == 109
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Fond validé : 33 régions/districts autonomes et 109 départements. Couverture Daoukro/Ouellé conservée.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("frontend/public/maps/civ-operational-background.json"))
    args = parser.parse_args()
    build(args.source, args.output)
