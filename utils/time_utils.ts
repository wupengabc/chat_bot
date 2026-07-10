function get_current_time() {
    return new Date().toISOString()
}

function format_time(time: string) {
    // 返回格式类似2026-01-01 00:00:00 格式化为中国时区
    return new Date(time).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
    })
}

export const time_utils = {
    get_current_time,
    format_time,
}