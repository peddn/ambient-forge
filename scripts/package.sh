#!/bin/sh
# Baut das Release-Paket und das Quellcode-Archiv nach dist/.
set -e
cd "$(dirname "$0")/.."

version=$(sed -n 's/^version = "\(.*\)"/\1/p' crates/server/Cargo.toml | head -1)
target=x86_64-unknown-linux-musl
name="ambient-forge-$version-linux-x86_64"

(cd admin && npm ci --silent && npm run build --silent && npm run check:plain --silent)
rustup target add "$target" >/dev/null 2>&1
cargo build --release --target "$target"

rm -rf dist
mkdir -p "dist/$name"
cp "target/$target/release/ambient-forge" "dist/$name/"
cp -r ambient-forge-web README.md "dist/$name/"
tar -czf "dist/$name.tar.gz" -C dist "$name"
rm -rf "dist/$name"

tar -czf "dist/ambient-forge-$version-source.tar.gz" \
  --exclude=.git --exclude=target --exclude=node_modules --exclude=dist \
  --exclude=ambient-forge-data --exclude=ambient-forge-web/admin \
  --exclude=e2e/data --exclude=e2e/output --exclude=e2e/media \
  --transform "s,^\.,ambient-forge-$version," .

ls -lh dist
