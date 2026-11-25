"""90-second presentation using the user's exact narration and real device captures."""
import asyncio
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import wave

import edge_tts
import numpy as np
from PIL import Image, ImageDraw, ImageOps

SPEC = importlib.util.spec_from_file_location("video_design", Path(__file__).with_name("create-presentation-video.py"))
design = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(design)
ROOT, FFMPEG = design.ROOT, design.FFMPEG
COMPACT = os.environ.get("SANTE_VIDEO_COMPACT") == "1"
PREVIOUS = ROOT / "docs/video-presentation/version-90-secondes"
OUT = ROOT / "docs/video-presentation" / ("version-fluide" if COMPACT else "version-90-secondes")
SHOTS = ROOT / "docs/video-presentation/captures-reelles/captures"
OUT.mkdir(parents=True, exist_ok=True)
W, H, FPS, SR = 720, 1280, 24, 24000
SCENES = [
    dict(duration=10, tag="LA SANTÉ PRÈS DE CHEZ VOUS", title="Un centre de santé.\nPrès de chez vous.", source="centers", color="#0891B2", crop=(0, 270, 1200, 1450),
         speech="Trouver un centre de santé proche de chez soi est essentiel."),
    dict(duration=12, tag="DES REPÈRES POUR CHACUN", title="Où se rendre ?\nQuels services trouver ?", source="offline", color="#1A56DB", crop=(0, 270, 1200, 1500),
         speech="Mais savoir où se rendre et quels services y sont disponibles reste parfois difficile."),
    dict(duration=13, tag="UNE INITIATIVE YEFA TECHNOLOGIE", title="La technologie\nau service de la proximité.", source="brand", color="#0891B2",
         speech="C’est pour faciliter cette recherche que la société YEFA TECHNOLOGIE met à disposition SANTÉ À PROXIMITÉ,"),
    dict(duration=13, tag="IDENTIFIER LES CENTRES PROCHES", title="Votre recherche.\nDes centres à proximité.", source="centers", color="#1A56DB", crop=(0, 270, 1200, 1730),
         speech="une application qui aide la population à identifier les centres de santé les plus proches"),
    dict(duration=12, tag="CONSULTER LES INFORMATIONS", title="Services et\nplateaux techniques.", source="offline", color="#059669", crop=(0, 680, 1200, 1450),
         speech="et à consulter les services ainsi que les plateaux techniques disponibles."),
    dict(duration=17, tag="UNE RECHERCHE ACTIVE", title="Une information utile.\nUne orientation facilitée.", source="assistant", color="#7C3AED", crop=(0, 120, 1200, 1800),
         speech="Grâce à une recherche active, elle simplifie l’accès à l’information et aide chacun à mieux s’orienter vers une structure adaptée à ses besoins."),
    dict(duration=13, tag="DÉCOUVRONS ENSEMBLE", title="SANTÉ\nÀ PROXIMITÉ", source="outro", color="#0891B2",
         speech="Découvrons ensemble SANTÉ À PROXIMITÉ : une information accessible pour des soins plus proches."),
]
assert sum(s["duration"] for s in SCENES) == 90
if COMPACT:
    SCENES[0]["providedImage"] = "image-1-1.jpeg"
    SCENES[1]["providedImage"] = "image-2-1.png"
    SCENES[2]["tag"] = "UNE INITIATIVE YÉFA TECHNOLOGIE"
    SCENES[2]["speech"] = SCENES[2]["speech"].replace("YEFA TECHNOLOGIE", "Yéfa Technologie")


async def voices():
    for i, scene in enumerate(SCENES):
        path = OUT / f"narration-{i+1}.mp3"
        if COMPACT and i != 2 and not path.exists() and (PREVIOUS / path.name).exists():
            import shutil
            shutil.copyfile(PREVIOUS / path.name, path)
        if not path.exists():
            await edge_tts.Communicate(scene["speech"], "fr-FR-DeniseNeural", rate="-10%", pitch="+1Hz").save(str(path))
        wav = path.with_suffix(".wav")
        args = [FFMPEG, "-y", "-i", path]
        if COMPACT:
            args += ["-af", "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB,areverse"]
        design.run(args + ["-ac", "1", "-ar", SR, wav])
        with wave.open(str(wav)) as audio:
            scene["audio"] = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").copy()
        scene["voiceDuration"] = len(scene["audio"]) / SR
        scene["voiceOffset"] = 0.04 if COMPACT else 0.65
        if COMPACT:
            scene["duration"] = math.ceil((scene["voiceDuration"] + 0.12) * FPS) / FPS
        if not COMPACT and scene["voiceDuration"] + 1 > scene["duration"]:
            raise ValueError(f"Narration too long for scene {i+1}")
        print(f"Voix {i+1}/7 : {scene['voiceDuration']:.1f} s, séquence {scene['duration']} s", flush=True)


def clean_shot(name):
    image = Image.open(SHOTS / f"{name}.png").convert("RGB")
    if name != "assistant":
        d = ImageDraw.Draw(image)
        d.rectangle((112, 113, 815, 148), fill=image.getpixel((500, 130)))
        d.rectangle((815, 181, 1185, 259), fill="#F0F4F8")
    return image


def base(scene):
    return design.base({**scene, "brand": "SANTÉ À PROXIMITÉ", "company": "YÉFA TECHNOLOGIE" if COMPACT else "YEFA TECHNOLOGIE"})


def main():
    asyncio.run(voices())
    total_duration = sum(s["duration"] for s in SCENES)
    transcript = " ".join(s["speech"] for s in SCENES)
    (OUT / "texte-fourni-voix-off.txt").write_text(transcript + "\n", encoding="utf-8")
    cursor, captions = 0, []
    for s in SCENES:
        s["start"] = cursor
        chunks = design.caption_chunks(s["speech"])
        total = sum(map(len, chunks))
        t = cursor + s["voiceOffset"]
        s["captions"] = []
        for chunk in chunks:
            end = t + s["voiceDuration"] * len(chunk) / total
            record = (t, end, chunk)
            s["captions"].append(record); captions.append(record)
            t = end
        cursor += s["duration"]

    samples = round(total_duration * SR)
    mix = np.zeros(samples, dtype=np.float32)
    for s in SCENES:
        start = round((s["start"] + s["voiceOffset"]) * SR)
        mix[start:start+len(s["audio"])] += s["audio"].astype(np.float32) / 32768
    # Original soft instrumental bed continues during time reserved to inspect screenshots.
    music = np.zeros(samples, dtype=np.float32)
    beat = 60 / 86
    chords = [(130.81,164.81,196,246.94),(110,130.81,164.81,196),(87.31,130.81,174.61,220),(98,146.83,196,246.94)]
    for n in range(math.ceil(total_duration/(beat/2))):
        start = round(n*beat/2*SR)
        length = min(int(2*SR), samples-start)
        if length <= 0: break
        t = np.arange(length)/SR
        freq = chords[(n//8)%4][n%4]*2
        env = (1-np.exp(-t*30))*np.exp(-t*2.8)
        tone = np.sin(2*np.pi*freq*t) + .18*np.sin(2*np.pi*2*freq*t)
        music[start:start+length] += (tone*env*.04).astype(np.float32)
    fade = np.minimum(1,np.arange(samples)/(2*SR))*np.minimum(1,np.arange(samples)[::-1]/(3*SR))
    mix = np.clip(mix*1.05+music*fade,-.98,.98)
    audio_path = OUT/"voix-et-musique.wav"
    with wave.open(str(audio_path),"wb") as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR)
        f.writeframes((mix*32767).astype("<i2").tobytes())

    def timestamp(value):
        ms=round(value*1000)
        return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}"
    (OUT/"sous-titres.srt").write_text("\n\n".join(f"{i+1}\n{timestamp(a)} --> {timestamp(b)}\n{c}" for i,(a,b,c) in enumerate(captions)),encoding="utf-8")
    app_logo = Image.open(ROOT/"mobile/assets/icon.png").convert("RGB")
    company_logo = Image.open(ROOT/"mobile/assets/logo-yefa.png").convert("RGB")
    bases = [base(s) for s in SCENES]
    shots = {s["source"]:clean_shot(s["source"]) for s in SCENES if s["source"] not in ["brand","outro"]}
    video_path = OUT/("Sante-a-proximite-presentation-fluide.mp4" if COMPACT else "Sante-a-proximite-presentation-1min30.mp4")
    log=open(OUT/"encodage.log","wb")
    process=subprocess.Popen([FFMPEG,"-y","-f","rawvideo","-vcodec","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-i",str(audio_path),"-vf","scale=1080:1920:flags=lanczos","-c:v","libx264","-preset","fast","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-b:a","160k","-t",str(total_duration),"-movflags","+faststart",str(video_path)],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=log)
    for i,s in enumerate(SCENES):
        for k in range(round(s["duration"]*FPS)):
            local=k/FPS; progress=local/s["duration"]
            im=bases[i].copy();d=ImageDraw.Draw(im)
            if s.get("providedImage"):
                supplied = Image.open(ROOT/"docs/video-presentation/images-introduction"/s["providedImage"]).convert("RGB")
                view = ImageOps.contain(supplied,(592,650),Image.Resampling.LANCZOS)
                design.card(d,(48,332,672,1010),"#F0F4F8",24)
                im.paste(view,((W-view.width)//2,344+(650-view.height)//2))
                d=ImageDraw.Draw(im)
                note = "Image fournie • fond cartographique Google" if i==0 else "Image fournie • services du centre"
                design.text(d,(60,1024),note,18,fill="#A9C9DD",width=600,center=True)
            elif s["source"] in ["brand","outro"]:
                logo=company_logo if s["source"]=="brand" else app_logo
                size=420+int(12*math.sin(progress*math.pi))
                thumb=ImageOps.contain(logo,(size,size),Image.Resampling.LANCZOS)
                panel=Image.new("RGB",(458,458),"white")
                panel.paste(thumb,((458-thumb.width)//2,(458-thumb.height)//2))
                mask=Image.new("L",panel.size)
                ImageDraw.Draw(mask).rounded_rectangle((0,0,458,458),radius=28,fill=255)
                im.paste(panel,(131,348),mask)
                d=ImageDraw.Draw(im)
                if s["source"]=="brand":
                    design.text(d,(48,855),"met à disposition",25,fill="#BFD8E8",width=624,center=True)
                    design.text(d,(48,902),"SANTÉ À PROXIMITÉ",36,width=624,center=True,bold=True)
                else:
                    design.text(d,(48,838),"Une information accessible",30,width=624,center=True,bold=True)
                    design.text(d,(48,886),"pour des soins plus proches.",30,width=624,center=True,bold=True)
                    design.card(d,(80,973,640,1040),"#0891B2")
                    design.text(d,(98,990),"Découvrons ensemble",28,width=524,center=True,bold=True)
            else:
                source=shots[s["source"]]
                box=s["crop"]
                # Gentle optical motion uses only pixels from the real screenshot.
                zoom=1+.035*math.sin(progress*math.pi)
                cx=(box[0]+box[2])/2;cy=(box[1]+box[3])/2
                bw=(box[2]-box[0])/zoom;bh=(box[3]-box[1])/zoom
                crop=source.crop((round(cx-bw/2),round(cy-bh/2),round(cx+bw/2),round(cy+bh/2)))
                view=ImageOps.contain(crop,(592,650),Image.Resampling.LANCZOS)
                design.card(d,(48,332,672,1010),"#F0F4F8",24)
                im.paste(view,((W-view.width)//2,344+(650-view.height)//2))
                d=ImageDraw.Draw(im)
                design.text(d,(60,1024),"Captures réelles de l’application",18,fill="#A9C9DD",width=600,center=True)
                if i==4:
                    design.text(d,(60,982),"Selon les informations renseignées par les centres",15,fill="#475569",width=600,center=True)
            absolute=s["start"]+local
            for a,b,content in s["captions"]:
                if a<=absolute<b:
                    design.card(d,(32,1080,688,1186),"#071323",15)
                    design.text(d,(52,1096),content,25,width=616,center=True,bold=True)
                    break
            d.rounded_rectangle((48,1241,672,1245),2,fill="#24415D")
            d.rounded_rectangle((48,1241,48+max(4,int(624*absolute/total_duration)),1245),2,fill="#55D7CE")
            fade_time=.08 if COMPACT else .45
            alpha=min(1,local/fade_time,(s["duration"]-local)/fade_time)
            if alpha<1:im=Image.blend(Image.new("RGB",im.size,"#08152D"),im,max(0,alpha))
            if k==2*FPS:im.save(OUT/f"apercu-{i+1}.jpg",quality=94)
            process.stdin.write(im.tobytes())
        print(f"Séquence {i+1}/7 exportée",flush=True)
    process.stdin.close();status=process.wait();log.close()
    if status:raise RuntimeError("Échec export : consulter encodage.log")
    metadata={"file":video_path.name,"durationSeconds":total_duration,"resolution":"1080x1920","narration":"Texte fourni par l’utilisateur, intégral ; prononciation Yéfa Technologie","voice":"fr-FR-DeniseNeural","screenshots":"Images du PDF fourni et captures réelles du mobile, données personnelles masquées","scenes":[{k:v for k,v in s.items() if k!="audio"} for s in SCENES]}
    (OUT/"presentation.json").write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"VIDÉO PRÊTE : {video_path}",flush=True)


if __name__=="__main__":
    main()
