# scripts/push.ps1
# 推送时自动将 package.json 中的本地 link: 依赖替换为 GitHub 仓库链接
# 推送完成后自动恢复本地开发链接
#
# 用法:
#   .\push.ps1                  # 默认推送当前分支到 origin 和 gitee
#   .\push.ps1 --force          # 强制推送当前分支到 origin 和 gitee
#   .\push.ps1 origin main      # 传入参数时仅按指定参数推送

$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
    throw "当前目录不在 Git 仓库中"
}

$repoRoot = $repoRoot.Trim()
$packageJson = Join-Path $repoRoot "package.json"
$backup = Join-Path $repoRoot "package.json.local.bak"

if (-not (Test-Path $packageJson)) {
    throw "未找到 package.json: $packageJson"
}

function Push-Repository {
    param([object[]]$PushArgs)

    if ($PushArgs.Count -gt 0 -and $PushArgs[0] -ne "--force") {
        git -C $repoRoot push @PushArgs
        if ($LASTEXITCODE -ne 0) {
            throw "推送失败 (exit code: $LASTEXITCODE)"
        }
        return
    }

    $branch = (git -C $repoRoot branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
        throw "无法获取当前 Git 分支"
    }

    $forceArgs = @()
    if ($PushArgs -contains "--force") {
        $forceArgs = @("--force")
    }

    foreach ($remote in @("origin", "gitee")) {
        git -C $repoRoot remote get-url $remote 1>$null 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "未找到 Git 远程仓库: $remote"
        }
        Write-Host "[push.ps1] 正在推送 $branch 到 $remote..." -ForegroundColor Cyan
        git -C $repoRoot push @forceArgs $remote $branch
        if ($LASTEXITCODE -ne 0) {
            throw "推送 $remote 失败 (exit code: $LASTEXITCODE)"
        }
    }
}

# 读取 package.json
$content = Get-Content $packageJson -Raw

# 检查是否有本地 link: 依赖
$hasLocalLinks = $content -match '"link:'

# 使用 -C 保证所有 Git 路径都相对于仓库根目录
git -C $repoRoot update-index --no-skip-worktree -- package.json 2>$null

if ($LASTEXITCODE -ne 0) {
    throw "无法取消 package.json 的 skip-worktree 状态"
}

if (-not $hasLocalLinks) {
    try {
        Push-Repository -PushArgs $args
        $pushExit = 0

        if ($pushExit -ne 0) {
            throw "推送失败 (exit code: $pushExit)"
        }

        Write-Host "[push.ps1] 推送完成" -ForegroundColor Green
    }
    finally {
        git -C $repoRoot update-index --skip-worktree -- package.json 2>$null
    }

    exit 0
}

$pushExit = 0
$backupCreated = $false

try {
    # 备份本地 package.json
    Copy-Item $packageJson $backup -Force
    $backupCreated = $true

    # 替换本地链接为 GitHub 仓库
    $pushContent = $content
    $pushContent = $pushContent -replace `
        '"minecraft-data":\s*"link:[^"]*"', `
        '"minecraft-data": "github:wupengabc/node-minecraft-data"'

    $pushContent = $pushContent -replace `
        '"minecraft-protocol":\s*"link:[^"]*"', `
        '"minecraft-protocol": "github:wupengabc/node-minecraft-protocol"'

    $pushContent = $pushContent -replace `
        '"mineflayer":\s*"link:[^"]*"', `
        '"mineflayer": "github:wupengabc/mineflayer"'

    Set-Content $packageJson $pushContent -NoNewline -Encoding utf8

    # 暂存根目录 package.json
    git -C $repoRoot add -- package.json

    if ($LASTEXITCODE -ne 0) {
        throw "无法暂存 package.json"
    }

    # 只有存在暂存区变更时才提交
    git -C $repoRoot diff --cached --quiet -- package.json
    $hasStagedChanges = $LASTEXITCODE -ne 0

    if ($hasStagedChanges) {
        git -C $repoRoot commit `
            -m "chore: replace local links with GitHub repos for push" `
            --no-verify

        if ($LASTEXITCODE -ne 0) {
            throw "提交 package.json 失败"
        }
    }
    else {
        Write-Host "[push.ps1] GitHub 依赖版本已经提交，无需重复提交" `
            -ForegroundColor Yellow
    }

    Write-Host "[push.ps1] 已替换本地链接为 GitHub 仓库，开始推送..." `
        -ForegroundColor Cyan

    Push-Repository -PushArgs $args
    $pushExit = 0

    if ($pushExit -ne 0) {
        throw "推送失败 (exit code: $pushExit)"
    }

    Write-Host "[push.ps1] 推送完成" -ForegroundColor Green
}
finally {
    # 无论推送成功还是失败，都恢复本地开发版本
    if ($backupCreated -and (Test-Path $backup)) {
        Copy-Item $backup $packageJson -Force
        Remove-Item $backup -Force
    }

    # 本地文件与 HEAD 不同，使用 skip-worktree 隐藏本地改动
    git -C $repoRoot update-index --skip-worktree -- package.json 2>$null
}

Write-Host "[push.ps1] 已恢复本地开发链接" -ForegroundColor Green