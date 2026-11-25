"""Create the French vertical promotional film, narration and editable subtitles.

Dependencies: Pillow, numpy, imageio-ffmpeg, edge-tts.
The optional tools directory can be supplied through PYTHONPATH.
"""
import asyncio
import json
import math
import os
from pathlib import Path
import re
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
BASE_OUT = ROOT / "docs/video-presentation"
REAL_CAPTURES = os.environ.get("SANTE_VIDEO_REAL_CAPTURES") == "1"
OUT = BASE_OUT / "captures-reelles" if REAL_CAPTURES else BASE_OUT
OUT.mkdir(parents=True, exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS, SR = 720, 1280, 24, 24000
FONT = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
BLUE, TEAL, GREEN, PURPLE = "#1A56DB", "#0891B2", "#059669", "#7C3AED"
SCENES = [
    {"tag": "PLUS PROCHE DE VOUS", "title": "Votre santé.\nUn repère près de vous.", "kind": "intro", "color": TEAL,
     "speech": "Trouver un centre de santé ne devrait pas être compliqué. Découvrez Santé Aproximité, votre repère pour mieux vous orienter."},
    {"tag": "TROUVER UN CENTRE", "title": "Les bons repères,\nau bon endroit.", "kind": "centers", "color": BLUE,
     "speech": "Recherchez les centres de santé, consultez les services renseignés et repérez leur distance. Puis ouvrez votre itinéraire."},
    {"tag": "VOTRE ASSISTANT IA", "title": "Parlez.\nL’assistant vous guide.", "kind": "assistant", "color": PURPLE,
     "speech": "Posez votre question par écrit ou à la voix. Avec Internet, l’assistant intelligent facilite votre recherche et peut lire sa réponse."},
    {"tag": "URGENCE SANITAIRE", "title": "Signaler.\nPartager sa position.", "kind": "emergency", "color": "#DC2626",
     "speech": "Signalez une urgence sanitaire avec votre position et les informations utiles. Retrouvez ensuite le suivi de vos propres signalements."},
    {"tag": "VOS REPÈRES HORS LIGNE", "title": "Le catalogue reste\nà portée de main.", "kind": "offline", "color": GREEN,
     "speech": "Téléchargez le catalogue des centres pour le consulter hors connexion. Les nouvelles informations se récupèrent avec Internet."},
    {"tag": "VOTRE AVIS COMPTE", "title": "Une expérience.\nUn avis utile.", "kind": "feedback", "color": TEAL,
     "speech": "Partagez votre satisfaction et vos observations pour faire entendre votre expérience des soins."},
    {"tag": "SANTÉ APROXIMITÉ", "title": "Mieux s’orienter.\nPlus près des soins.", "kind": "outro", "color": BLUE,
     "speech": "Santé Aproximité. Mieux s’orienter, plus près des soins. Découvrez l’application et partagez-la autour de vous."},
]


def run(args):
    subprocess.run([str(a) for a in args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


async def narration():
    import edge_tts
    for i, scene in enumerate(SCENES):
        mp3, wav = OUT / f"voice-{i}.mp3", OUT / f"voice-{i}.wav"
        if REAL_CAPTURES and not mp3.exists() and (BASE_OUT / mp3.name).exists():
            import shutil
            shutil.copyfile(BASE_OUT / mp3.name, mp3)
        if not mp3.exists():
            await edge_tts.Communicate(scene["speech"], "fr-FR-DeniseNeural", rate="+5%", pitch="+1Hz").save(str(mp3))
        run([FFMPEG, "-y", "-i", mp3, "-ac", "1", "-ar", SR, wav])
        with wave.open(str(wav)) as f:
            scene["audio"] = np.frombuffer(f.readframes(f.getnframes()), dtype="<i2").copy()
        scene["duration"] = math.ceil((len(scene["audio"]) / SR + 0.5) * FPS) / FPS
        print(f"Voix {i + 1}/7 prête ({scene['duration']:.1f} s)", flush=True)


def font(size, bold=False):
    return ImageFont.truetype(str(FONT / ("segoeuib.ttf" if bold else "segoeui.ttf")), size)


def wrap(text, width, size, bold=False):
    f = font(size, bold)
    lines = []
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split():
            trial = f"{line} {word}".strip()
            if f.getlength(trial) > width and line:
                lines.append(line)
                line = word
            else:
                line = trial
        lines.append(line)
    return lines


def text(draw, xy, content, size, fill="#FFFFFF", width=600, bold=False, center=False):
    x, y = xy
    f = font(size, bold)
    for line in wrap(content, width, size, bold):
        left = x + (width - f.getlength(line)) / 2 if center else x
        draw.text((left, y), line, font=f, fill=fill)
        y += size * 1.28
    return y


def card(draw, box, fill="#FFFFFF", radius=22, outline=None):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=2)


def base(scene):
    arr = np.zeros((H, W, 3), dtype=np.uint8)
    for y in range(H):
        p = y / H
        arr[y, :, :] = [int(8 + 6 * p), int(21 + 15 * p), int(45 + 16 * p)]
    im = Image.fromarray(arr)
    d = ImageDraw.Draw(im)
    d.ellipse((430, -150, 990, 410), fill="#12335B")
    d.ellipse((-350, 810, 180, 1340), fill="#0A3849")
    text(d, (48, 43), scene.get("brand", "SANTÉ APROXIMITÉ"), 20, bold=True)
    card(d, (48, 107, 56, 133), scene["color"], 3)
    text(d, (72, 107), scene["tag"], 17, fill="#9DDDE6", bold=True)
    text(d, (48, 165), scene["title"], 43, bold=True)
    text(d, (48, 1200), scene.get("company", "YEFA TECHNOLOGIE"), 16, fill="#91AAC4")
    return im


def phone(scene, i):
    if REAL_CAPTURES:
        shot = Image.open(OUT / "captures" / f"{scene['kind']}.png").convert("RGB")
        sd = ImageDraw.Draw(shot)
        # Account identity and profile shortcut occupy the same header in these captures.
        if scene["kind"] != "assistant":
            sd.rectangle((112, 113, 815, 148), fill=shot.getpixel((500, 130)))
            sd.rectangle((815, 181, 1185, 259), fill="#F0F4F8")
        # Hide device status/navigation bars; keep the app and map attribution intact.
        crop_top = 45 if scene["kind"] == "assistant" else 65
        shot = shot.crop((0, crop_top, shot.width, 1835))
        # The emergency form displays a private telephone number.
        if scene["kind"] == "emergency":
            regions = json.loads((OUT / "redactions.json").read_text(encoding="utf-8"))
            for box in regions.get("emergency", []):
                x1, y1, x2, y2 = box
                ImageDraw.Draw(shot).rectangle((x1, y1-65, x2, y2-65), fill="#FFFFFF")
        p = Image.new("RGB", (494, 680), "#0C1627")
        d = ImageDraw.Draw(p)
        card(d, (6, 6, 488, 674), "#F0F4F8", 28)
        shot.thumbnail((460, 640), Image.Resampling.LANCZOS)
        mask = Image.new("L", shot.size)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=13, fill=255)
        p.paste(shot, ((494-shot.width)//2, 16), mask)
        text(d, (22, 651), "Capture réelle de l’application", 15, fill="#475569", width=450, center=True)
        return p
    p = Image.new("RGB", (494, 680), "#0C1627")
    d = ImageDraw.Draw(p)
    card(d, (8, 8, 486, 672), "#F0F4F8", 35)
    d.rounded_rectangle((18, 18, 476, 101), 25, fill=scene["color"])
    text(d, (39, 39), "Santé Aproximité", 24, bold=True)
    if scene["kind"] == "centers":
        shot = Image.open(ROOT / "docs/mobile-real-shots-expo/01-centres.png").convert("RGB")
        # Keep the real map and its attribution; omit account header and keyboard.
        shot = shot.crop((0, 363, 1200, 1260))
        shot.thumbnail((446, 450), Image.Resampling.LANCZOS)
        p.paste(shot, ((494 - shot.width) // 2, 124))
        text(d, (33, 490), "Centres • Services • Distance", 23, fill="#18324B", width=430, bold=True)
        card(d, (30, 552, 464, 608), TEAL)
        text(d, (44, 566), "Consulter les itinéraires", 23, width=408, center=True, bold=True)
        text(d, (40, 631), "Capture de l’application", 16, fill="#64748B")
    elif scene["kind"] == "assistant":
        text(d, (35, 124), "Votre assistant IA", 29, fill="#172A43", bold=True)
        card(d, (32, 190, 462, 296), "#EDE9FE")
        text(d, (53, 213), "Je cherche un centre\navec une maternité.", 25, fill="#423178", width=390)
        card(d, (32, 329, 462, 454), "#FFFFFF", outline="#DDD6FE")
        text(d, (53, 350), "Une recherche assistée\ndans le catalogue des centres.", 23, fill="#334155", width=385)
        for j in range(23):
            h = 12 + int(32 * abs(math.sin(j * 0.85)))
            d.rounded_rectangle((68 + j * 16, 521 - h // 2, 74 + j * 16, 521 + h // 2), 3, fill=PURPLE)
        text(d, (38, 575), "Micro    •    Envoyer    •    Annuler", 22, fill=PURPLE, width=420, center=True, bold=True)
        text(d, (36, 630), "Illustration • connexion Internet requise", 16, fill="#64748B")
    elif scene["kind"] == "emergency":
        shot = Image.open(ROOT / "docs/mobile-real-shots/urgence-sanitaire.png").convert("RGB")
        # Do not expose personal account names or phone numbers in the film.
        sd = ImageDraw.Draw(shot)
        sd.rectangle((55, 559, 1139, 632), fill="#FFFFFF")
        sd.text((70, 570), "Votre numéro de téléphone", font=font(31), fill="#64748B")
        shot = shot.crop((0, 135, 1200, 1710))
        shot.thumbnail((444, 519), Image.Resampling.LANCZOS)
        p.paste(shot, ((494 - shot.width) // 2, 112))
        text(d, (38, 631), "Capture • données personnelles masquées", 15, fill="#64748B")
    elif scene["kind"] == "offline":
        d.ellipse((159, 142, 335, 318), fill="#D1FAE5")
        d.line([(203, 226), (233, 257), (294, 195)], fill=GREEN, width=13)
        text(d, (40, 355), "Catalogue téléchargé", 31, fill="#0B5A43", width=414, center=True, bold=True)
        text(d, (55, 425), "Consultez les centres\net leurs informations enregistrées.", 25, fill="#334155", width=384, center=True)
        card(d, (34, 555, 460, 619), "#E0F2FE")
        text(d, (52, 571), "Dernières données synchronisées", 22, fill="#075985", width=390, center=True)
    elif scene["kind"] == "feedback":
        text(d, (36, 144), "Votre expérience compte", 30, fill="#172A43", width=422, center=True, bold=True)
        text(d, (52, 241), "★ ★ ★ ★ ★", 49, fill="#D97706", width=390, center=True)
        card(d, (35, 348, 459, 427), "#D1FAE5")
        text(d, (50, 370), "Partager ma satisfaction", 25, fill="#065F46", width=390, center=True, bold=True)
        card(d, (35, 452, 459, 565), "#FFFFFF", outline="#CBD5E1")
        text(d, (55, 476), "Décrire mon expérience\net mes observations", 25, fill="#475569", width=380)
        text(d, (40, 627), "Illustration des fonctions de retour usager", 15, fill="#64748B")
    return p


def caption_chunks(speech):
    # Keep complete words and punctuation in short two-line reading units.
    words = speech.split()
    chunks, chunk = [], ""
    for word in words:
        if len(chunk) + len(word) + 1 > 75 and chunk:
            chunks.append(chunk)
            chunk = ""
        chunk = (chunk + " " + word).strip()
    if chunk:
        chunks.append(chunk)
    return chunks


def prepare():
    cursor = 0.0
    captions = []
    for i, scene in enumerate(SCENES):
        scene["start"] = cursor
        chunks = caption_chunks(scene["speech"])
        total = sum(len(c) for c in chunks)
        offset = 0.12
        audio_duration = len(scene["audio"]) / SR
        scene["captions"] = []
        for chunk in chunks:
            duration = (audio_duration - 0.12) * len(chunk) / total
            record = (cursor + offset, cursor + offset + duration, chunk)
            scene["captions"].append(record)
            captions.append(record)
            offset += duration
        cursor += scene["duration"]
    return cursor, captions


def main():
    asyncio.run(narration())
    duration, captions = prepare()
    total_samples = int(duration * SR)
    voice = np.zeros(total_samples, dtype=np.float32)
    for s in SCENES:
        start = round(s["start"] * SR)
        end = min(total_samples, start + len(s["audio"]))
        voice[start:end] += s["audio"][:end-start].astype(np.float32) / 32768

    # Original, softly synthesized background: no third-party music recording.
    music = np.zeros(total_samples, dtype=np.float32)
    chords = [(130.81, 164.81, 196, 246.94), (110, 130.81, 164.81, 196), (87.31, 130.81, 174.61, 220), (98, 146.83, 196, 246.94)]
    beat = 60 / 90
    for n in range(math.ceil(duration / (beat / 2))):
        start = int(n * beat / 2 * SR)
        length = min(int(1.6 * SR), total_samples - start)
        if length <= 0:
            break
        t = np.arange(length) / SR
        frequency = chords[(n // 8) % 4][n % 4] * 2
        tone = np.sin(2 * np.pi * frequency * t) + 0.22 * np.sin(2 * np.pi * frequency * 2 * t)
        env = (1 - np.exp(-t * 35)) * np.exp(-t * 3.2)
        music[start:start+length] += (tone * env * 0.026).astype(np.float32)
    fade = np.minimum(1, np.arange(total_samples) / (SR * 1.5)) * np.minimum(1, np.arange(total_samples)[::-1] / (SR * 2.5))
    mixed = np.clip(voice * 1.05 + music * fade, -0.98, 0.98)
    audio_path = OUT / "narration-et-musique.wav"
    with wave.open(str(audio_path), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((mixed * 32767).astype("<i2").tobytes())

    def timestamp(value):
        ms = round(value * 1000)
        return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}"
    (OUT / "sous-titres.srt").write_text("\n\n".join(f"{i+1}\n{timestamp(a)} --> {timestamp(b)}\n{c}" for i, (a,b,c) in enumerate(captions)), encoding="utf-8")
    (OUT / "texte-voix-off.txt").write_text("\n\n".join(s["speech"] for s in SCENES), encoding="utf-8")

    logo = Image.open(ROOT / "mobile/assets/icon.png").convert("RGB")
    bases = [base(s) for s in SCENES]
    phones = {i: phone(s, i) for i, s in enumerate(SCENES) if s["kind"] not in ["intro", "outro"]}
    for i, s in enumerate(SCENES):
        if s["kind"] in ["intro", "outro"]:
            thumb = logo.resize((438, 438), Image.Resampling.LANCZOS)
            mask = Image.new("L", thumb.size)
            ImageDraw.Draw(mask).rounded_rectangle((0,0,438,438), radius=36, fill=255)
            bases[i].paste(thumb, (141, 375), mask)
            d = ImageDraw.Draw(bases[i])
            text(d, (48, 865), "Centres de santé  •  Assistant IA\nSignalements  •  Avis des usagers", 25, fill="#C7DFED", width=624, center=True)
            if s["kind"] == "outro":
                card(d, (68, 980, 652, 1055), TEAL)
                text(d, (90, 998), "Découvrez l’application", 31, width=540, center=True, bold=True)
        elif s["kind"] == "emergency":
            text(ImageDraw.Draw(bases[i]), (48, 1022), "En cas de danger immédiat, appelez les secours.", 18, fill="#FECACA", width=624, center=True)
        elif s["kind"] == "offline":
            text(ImageDraw.Draw(bases[i]), (48, 1022), "Carte, itinéraires et IA : connexion nécessaire.", 18, fill="#B5E9E0", width=624, center=True)

    video_path = OUT / ("Sante-Aproximite-captures-reelles.mp4" if REAL_CAPTURES else "Sante-Aproximite-presentation-verticale.mp4")
    log = open(OUT / "encodage.log", "wb")
    process = subprocess.Popen([FFMPEG, "-y", "-f", "rawvideo", "-vcodec", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", str(audio_path), "-vf", "scale=1080:1920:flags=lanczos", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", str(video_path)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=log)
    for i, s in enumerate(SCENES):
        frame_count = round(s["duration"] * FPS)
        for k in range(frame_count):
            local = k / FPS
            absolute = s["start"] + local
            im = bases[i].copy()
            if i in phones:
                dy = int(20 * math.exp(-local * 3) + 3 * math.sin(local * 0.8))
                im.paste(phones[i], (113, 330 + dy))
            d = ImageDraw.Draw(im)
            if s["kind"] == "assistant" and not REAL_CAPTURES:
                for j in range(23):
                    h = int(8 + 30 * abs(math.sin(local * 4 + j * 0.5)))
                    d.rounded_rectangle((181+j*16, 851-h//2, 187+j*16, 851+h//2), 3, fill=PURPLE)
            for a, b, content in s["captions"]:
                if a <= absolute < b:
                    card(d, (32, 1080, 688, 1186), "#071323", 15)
                    text(d, (52, 1096), content, 25, width=616, center=True, bold=True)
                    break
            progress = (absolute / duration)
            d.rounded_rectangle((48, 1241, 672, 1245), 2, fill="#24415D")
            d.rounded_rectangle((48, 1241, 48 + max(4, int(624 * progress)), 1245), 2, fill="#55D7CE")
            # Short fade through the dark brand background at each scene boundary.
            alpha = min(1.0, local / 0.25, (s["duration"] - local) / 0.25)
            if alpha < 1:
                im = Image.blend(Image.new("RGB", im.size, "#08152D"), im, max(0, alpha))
            if k == FPS * 2:
                im.save(OUT / f"apercu-{i+1}.jpg", quality=92)
            process.stdin.write(im.tobytes())
        print(f"Séquence {i+1}/7 encodée", flush=True)
    process.stdin.close()
    status = process.wait()
    log.close()
    if status:
        raise RuntimeError(f"FFmpeg failed ({status}); see encodage.log")
    manifest = {"file": video_path.name, "durationSeconds": duration, "resolution": "1080x1920", "fps": FPS, "voice": "fr-FR-DeniseNeural", "music": "Composition synthétique originale", "audience": "grand public", "scenes": [{k:v for k,v in s.items() if k != "audio"} for s in SCENES]}
    (OUT / "presentation.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"MP4 prêt : {video_path} ({duration:.1f} s)", flush=True)


if __name__ == "__main__":
    main()
