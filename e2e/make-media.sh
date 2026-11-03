#!/bin/sh
# Erzeugt die Testmedien für e2e/run.cjs. Braucht ffmpeg.
set -e
cd "$(dirname "$0")"
mkdir -p media
cd media
quiet="-loglevel error -y"
ffmpeg $quiet -f lavfi -i "color=c=0x8a2be2:s=1280x720:d=1" -frames:v 1 lila.png
ffmpeg $quiet -f lavfi -i "color=c=0xff8c00:s=1280x720:d=1" -frames:v 1 -q:v 3 orange.jpg
ffmpeg $quiet -f lavfi -i "color=c=0x2e8b57:s=1280x720:d=1" -frames:v 1 gruen.webp
ffmpeg $quiet -f lavfi -i "sine=frequency=220:duration=2:sample_rate=48000" -ac 2 -c:a pcm_s16le regen.wav
ffmpeg $quiet -f lavfi -i "sine=frequency=110:duration=20:sample_rate=48000" -ac 2 -c:a pcm_s16le gross.wav
ffmpeg $quiet -f lavfi -i "sine=frequency=440:duration=8:sample_rate=48000" -ac 2 -b:a 128k musik.mp3
ffmpeg $quiet -f lavfi -i "sine=frequency=880:duration=1:sample_rate=48000" -ac 2 -c:a flac donner.flac
ffmpeg $quiet -f lavfi -i "sine=frequency=660:duration=1:sample_rate=48000" -ac 2 -c:a libopus -b:a 64k tuer.opus
ffmpeg $quiet -f lavfi -i "sine=frequency=330:duration=1:sample_rate=48000" -ac 2 -c:a libvorbis wind.ogg
echo "<html>keine Medien</html>" > kaputt.mp3
# Sieht am Anfang wie MP3 aus, lässt sich aber nicht dekodieren.
{ printf 'ID3\004\000\000\000\000\000\000'; head -c 4096 /dev/zero; } > defekt.mp3
