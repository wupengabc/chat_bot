import assert from "node:assert/strict"
import {filter_text, reload} from "../service/sensitive_filter/index.js"

reload({enabled: true, sensitive_words: ["敏感词"]})
assert.equal(filter_text("这是敏感词，后面的文字应保留。"), "这是***，后面的文字应保留。")
assert.equal(filter_text("链接 https://example.com/敏感词?title=敏感词 应完整保留。"), "链接 https://example.com/敏感词?title=敏感词 应完整保留。")
reload({enabled: true, sensitive_words: []})
