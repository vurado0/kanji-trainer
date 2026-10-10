#!/usr/bin/env bash
# One-off download of the upstream data dumps into tools/cache/.
# Only needed to regenerate /data — the app itself never touches the network.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p cache && cd cache

echo "KANJIDIC2 …"
curl -sSL -o kanjidic2.xml.gz "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz"
gunzip -kf kanjidic2.xml.gz

echo "KanjiVG …"
KVG=$(curl -sSL "https://api.github.com/repos/KanjiVG/kanjivg/releases/latest" \
  | python3 -c "import json,sys;print(next(a['browser_download_url'] for a in json.load(sys.stdin)['assets'] if a['name'].endswith('.xml.gz')))")
curl -sSL -o kanjivg.xml.gz "$KVG"
gunzip -kf kanjivg.xml.gz

echo "JMdict (eng-common) …"
JM=$(curl -sSL "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest" \
  | python3 -c "import json,sys;print(next(a['browser_download_url'] for a in json.load(sys.stdin)['assets'] if a['name'].startswith('jmdict-eng-common') and a['name'].endswith('.json.tgz')))")
curl -sSL -o jmdict-eng-common.json.tgz "$JM"
rm -rf jm && mkdir -p jm && tar xzf jmdict-eng-common.json.tgz -C jm

echo "JLPT levels …"
curl -sSL -o kanji-data.json "https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json"

echo "done — now run: node tools/build-data.mjs"
