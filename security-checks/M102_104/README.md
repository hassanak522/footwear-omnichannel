# M102–M104 read-only baseline verification

Based on the uploaded source ZIP. This is a static evidence collection package, **not** end-to-end runtime certification.

M102: order lifecycle source inventory. M103: warehouse/branch stock-integrity source inventory. M104: finance and audit source inventory.

Run from PowerShell:
```powershell
Expand-Archive -Path G:\M102_104_PACKAGE.zip -DestinationPath G:\m102-extract -Force
New-Item -ItemType Directory -Force -Path G:\footwear-omnichannel\security-checks\M102_104 | Out-Null
Copy-Item G:\m102-extract\* G:\footwear-omnichannel\security-checks\M102_104 -Recurse -Force
& G:\footwear-omnichannel\security-checks\M102_104\RUN_M102_104.ps1 -Root 'G:\footwear-omnichannel' -Milestone ALL
```

Reports are saved in `security-checks/M102_104/reports`. No database connection is attempted. Review `NOT_FOUND_REVIEW_REQUIRED` manually, because implementations may exist in other modules.
