#!/usr/bin/env python3
"""Install the current user's macOS refresh schedule (every 15 minutes while awake)."""
import os
import plistlib
import subprocess
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
label='com.dirtiq.refresh'
p=Path.home()/'Library/LaunchAgents'/f'{label}.plist'
p.parent.mkdir(parents=True,exist_ok=True)
payload={'Label':label,'ProgramArguments':[sys.executable,str(ROOT/'scripts/auto_refresh.py')],
         'WorkingDirectory':str(ROOT),'StartInterval':900,'RunAtLoad':True,
         'StandardOutPath':str(ROOT/'data/scheduled-refresh.log'),'StandardErrorPath':str(ROOT/'data/scheduled-refresh-error.log'),
         'EnvironmentVariables':{'PATH':os.environ.get('PATH','/usr/bin:/bin'),'OMP_NUM_THREADS':'4','OPENBLAS_NUM_THREADS':'4'}}
if p.exists():
    old=plistlib.loads(p.read_bytes())
    if old.get('Label')!=label:raise RuntimeError('Unexpected existing launch agent')
    subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}',str(p)],capture_output=True)
p.write_bytes(plistlib.dumps(payload))
subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(p)],check=True)
print(f'Installed {p}; runs every 15 minutes while this Mac is awake and logged in.')
