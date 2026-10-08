"""Build using the existing signing key supplied explicitly through environment variables."""
import argparse
import subprocess
from pathlib import Path
from android_tools import ROOT, environment, gradle


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true', help='Use previously cached dependencies only')
    args = parser.parse_args()
    env = environment()
    missing = [key for key in ['MESIMA_KEYSTORE', 'MESIMA_STORE_PASSWORD', 'MESIMA_KEY_ALIAS', 'MESIMA_KEY_PASSWORD'] if not env.get(key)]
    if missing:
        parser.error('Supply the existing release signing configuration: ' + ', '.join(missing))
    if not Path(env['MESIMA_KEYSTORE']).is_file():
        parser.error('MESIMA_KEYSTORE does not point to an existing key')
    command = [gradle(), '-p', str(ROOT / 'android'), '--no-daemon', 'assembleRelease', 'testDebugUnitTest']
    if args.offline:
        command.append('--offline')
    return subprocess.run(command, env=env).returncode


if __name__ == '__main__':
    raise SystemExit(main())
