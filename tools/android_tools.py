"""Shared, portable locations for the Android release scripts."""
from pathlib import Path
import os
import shutil

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path(os.environ.get('MESIMA_TOOLS_DIR', ROOT.parent / '.mesima-build-tools')) / 'android'


def environment():
    env = os.environ.copy()
    env.setdefault('ANDROID_HOME', env.get('ANDROID_SDK_ROOT', str(TOOLS / 'sdk')))
    env.setdefault('GRADLE_USER_HOME', str(TOOLS / 'gradle-cache'))
    if not env.get('JAVA_HOME') and (TOOLS / 'jdk').is_dir():
        candidates = sorted(p for p in (TOOLS / 'jdk').iterdir() if p.is_dir())
        if candidates:
            env['JAVA_HOME'] = str(candidates[0])
    return env


def gradle():
    local = TOOLS / 'gradle-8.9/bin' / ('gradle.bat' if os.name == 'nt' else 'gradle')
    result = str(local) if local.is_file() else shutil.which('gradle')
    if not result:
        raise RuntimeError('Gradle 8.9 is missing. Run tools/setup-android.ps1, add Gradle to PATH, or set MESIMA_TOOLS_DIR.')
    return result


def sdk_tool(name, env):
    suffix = '.bat' if name == 'apksigner' else '.exe'
    filename = name + suffix if os.name == 'nt' else name
    result = Path(env['ANDROID_HOME']) / 'build-tools/35.0.0' / filename
    if not result.is_file():
        raise RuntimeError('Android build-tools 35.0.0 are missing. Set ANDROID_HOME or run tools/setup-android.ps1.')
    return str(result)
