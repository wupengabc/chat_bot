# scripts/push.ps1
# 推送时自动将 package.json 中的本地 link: 依赖替换为 GitHub 仓库链接
# 推送完成后自动恢复本地开发链接
#
# 用法:
#   .\scripts\push.ps1              # 等同于 git push
#   .\scripts\push.ps1 --force      # 等同于 git push --force
#   .\scripts\push.ps1 origin main  # 等同于 git push origin main

$ErrorActionPreference = "Stop"
$repoRoot = git rev-parse --show-toplevel
$packageJson = Join-Path $repoRoot "package.json"
$backup = Join-Path $repoRoot "package.json.local.bak"

# 读取 package.json
$content = Get-Content $packageJson -Raw

# 检查是否有本地 link: 依赖
$hasLocalLinks = $content -match '"link:'

if ($hasLocalLinks) {
    # 备份原始 package.json
    Copy-Item $packageJson $backup -Force

    # 替换本地链接为 GitHub 仓库
    $content = $content -replace '"minecraft-data":\s*"link:[^"]*"', '"minecraft-data": "github:wupengabc/node-minecraft-data"'
    $content = $content -replace '"minecraft-protocol":\s*"link:[^"]*"', '"minecraft-protocol": "github:wupengabc/node-minecraft-protocol"'
    $content = $content -replace '"mineflayer":\s*"link:[^"]*"', '"mineflayer": "github:wupengabc/mineflayer"'

    Set-Content $packageJson $content -NoNewline

    # 提交替换
    git add package.json
    git commit -m "chore: replace local links with GitHub repos for push" --no-verify

    Write-Host "[push.ps1] 已替换本地链接为 GitHub 仓库，开始推送..." -ForegroundColor Cyan

    # 推送
    $pushArgs = $args -join " "
    git push $pushArgs
    $pushExit = $LASTEXITCODE

    # 恢复本地链接
    Copy-Item $backup $packageJson -Force
    Remove-Item $backup -Force
    git add package.json
    git commit -m "chore: restore local dev dependencies" --no-verify

    if ($pushExit -ne 0) {
        Write-Error "推送失败 (exit code: $pushExit)"
        exit $pushExit
    }

    Write-Host "[push.ps1] 推送完成，已恢复本地开发链接" -ForegroundColor Green
} else {
    # 没有本地链接，直接推送
    $pushArgs = $args -join " "
    git push $pushArgs
}
