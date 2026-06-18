export default function AboutView(): JSX.Element {
  const virtues = [
    { k: '仁', t: '以人为本', d: '替你接走排版、做表、套格式的苦活，让你专心做人、做事。', q: '「爱人」·《论语·颜渊》' },
    { k: '礼', t: '得体合宜', d: '公文、函件、单据，皆循礼数、分毫不失。', q: '「不学礼，无以立」·《论语·季氏》' },
    { k: '义', t: '忠实不欺', d: '述而不作——只录你所给的信息，绝不杜撰一字一数。', q: '「见利思义」·《论语·宪问》' }
  ]
  const feats = [
    '一句话出单据（送货单 / 报价单 / 对账单 / 装箱单…）',
    '抽取表格 · 套用模板 · 格式转换',
    '外贸合同审查 · 风险条款标注',
    '文件本地处理，后端代理、密钥不外泄'
  ]
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand text-4xl font-black text-[#3a2a05]">墨</div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">墨童 · AI 文员</h1>
          <p className="text-sm text-muted">子夏旗下 · 承孔门「文学」之传</p>
        </div>
      </div>

      <p className="mt-6 text-[15px] leading-relaxed text-slate-700">
        墨童，出自先贤<b className="text-slate-900">子夏（卜商）</b>门下——孔门「文学」科、传经之祖。子夏执笔传经，墨童便是其案前磨墨抄录的小书童；
        今化身 <b className="text-slate-900">AI 文员</b>，承这一脉文书之学，替天下文书人接走「器」的活，让人「学以致其道」。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {virtues.map((v) => (
          <div key={v.k} className="rounded-2xl border border-edge bg-panel p-5">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-lg font-black text-[#3a2a05]">{v.k}</span>
              <span className="font-semibold text-slate-800">{v.t}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{v.d}</p>
            <p className="mt-2 text-xs text-muted">{v.q}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-9 text-base font-semibold text-slate-800">产品特色</h2>
      <ul className="mt-3 space-y-2">
        {feats.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
            {f}
          </li>
        ))}
      </ul>

      <p className="mt-10 border-t border-edge pt-5 text-xs text-muted">
        子夏旗下 · 墨童 AI 文员　·　仁以待人，礼以成文，义以立信。
      </p>
    </div>
  )
}
