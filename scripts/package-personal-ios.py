#!/usr/bin/env python3
"""Package an unsigned Xcode archive and a Feather-compatible release source."""
import datetime
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

archive, output = map(Path, sys.argv[1:])
output.mkdir(parents=True, exist_ok=True)
apps = list((archive / "Products/Applications").glob("*.app"))
if len(apps) != 1:
    raise SystemExit(f"Expected one archived app, found {len(apps)}")
app = apps[0]
with (app / "Info.plist").open("rb") as file:
    info = plistlib.load(file)
if info.get("CFBundleSupportedPlatforms") != ["iPhoneOS"]:
    raise SystemExit("Archive must contain an iPhoneOS device build")
release = os.environ["RELEASE_VERSION"]
repository = os.environ["GITHUB_REPOSITORY"]
filename = f"T3-Code-{release}-preview-unsigned.ipa"
with tempfile.TemporaryDirectory() as temp:
    payload = Path(temp) / "Payload"
    payload.mkdir()
    shutil.copytree(app, payload / app.name, symlinks=True)
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent",
                    str(payload), str((output / filename).resolve())], check=True)
base = f"https://github.com/{repository}"
assets = f"{base}/releases/download/personal-v{release}"
icon = "feather-icon.png"
shutil.copyfile("assets/nightly/nightly-ios-1024.png", output / icon)
version = {
    "version": info["CFBundleShortVersionString"],
    "buildVersion": info["CFBundleVersion"],
    "date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "localizedDescription": f"Personal release {release}. Unsigned; sign in Feather before installing.",
    "downloadURL": f"{assets}/{filename}",
    "size": (output / filename).stat().st_size,
    "minOSVersion": info["MinimumOSVersion"],
}
source = {
    "name": "T3 Code Personal",
    "identifier": "com.skulldogged.t3code.source",
    "sourceURL": f"{base}/releases/latest/download/feather.json",
    "iconURL": f"{assets}/{icon}",
    "website": base,
    "apps": [{
        "name": info["CFBundleDisplayName"],
        "bundleIdentifier": info["CFBundleIdentifier"],
        "developerName": "T3 Tools / skulldogged",
        "iconURL": f"{assets}/{icon}",
        "localizedDescription": "T3 Code personal build for iPhone and iPad. Sign with your own certificate in Feather. Includes widget and share extensions; their capabilities depend on your signing profile.",
        "versions": [version],
        "version": version["version"],
        "versionDate": version["date"],
        "downloadURL": version["downloadURL"],
        "size": version["size"],
    }],
    "news": [],
}
(output / "feather.json").write_text(json.dumps(source, indent=2) + "\n")
print(f"Packaged {filename} ({version['size']} bytes), iOS {version['version']}")
