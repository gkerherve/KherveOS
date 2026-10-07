// The Symbol palette (khervedoc/symbols.py): [LaTeX, glyph] per group.
// Text-mode macros go in as raw LaTeX, everything else as inline maths.

export const SYMBOL_GROUPS: [string, [string, string][]][] = [
  ["Greek (lowercase)", [
    ["\\alpha", "α"], ["\\beta", "β"], ["\\gamma", "γ"], ["\\delta", "δ"], ["\\epsilon", "ε"], ["\\varepsilon", "ɛ"],
    ["\\zeta", "ζ"], ["\\eta", "η"], ["\\theta", "θ"], ["\\vartheta", "ϑ"], ["\\iota", "ι"], ["\\kappa", "κ"],
    ["\\lambda", "λ"], ["\\mu", "μ"], ["\\nu", "ν"], ["\\xi", "ξ"], ["\\pi", "π"], ["\\varpi", "ϖ"],
    ["\\rho", "ρ"], ["\\varrho", "ϱ"], ["\\sigma", "σ"], ["\\varsigma", "ς"], ["\\tau", "τ"], ["\\upsilon", "υ"],
    ["\\phi", "φ"], ["\\varphi", "ϕ"], ["\\chi", "χ"], ["\\psi", "ψ"], ["\\omega", "ω"],
  ]],
  ["Greek (uppercase)", [
    ["\\Gamma", "Γ"], ["\\Delta", "Δ"], ["\\Theta", "Θ"], ["\\Lambda", "Λ"], ["\\Xi", "Ξ"], ["\\Pi", "Π"],
    ["\\Sigma", "Σ"], ["\\Upsilon", "Υ"], ["\\Phi", "Φ"], ["\\Psi", "Ψ"], ["\\Omega", "Ω"],
  ]],
  ["Operators", [
    ["\\pm", "±"], ["\\mp", "∓"], ["\\times", "×"], ["\\div", "÷"], ["\\cdot", "·"], ["\\ast", "∗"],
    ["\\star", "⋆"], ["\\circ", "∘"], ["\\bullet", "•"], ["\\oplus", "⊕"], ["\\ominus", "⊖"], ["\\otimes", "⊗"],
    ["\\oslash", "⊘"], ["\\odot", "⊙"], ["\\dagger", "†"], ["\\ddagger", "‡"],
  ]],
  ["Relations", [
    ["\\leq", "≤"], ["\\geq", "≥"], ["\\neq", "≠"], ["\\approx", "≈"], ["\\equiv", "≡"], ["\\sim", "∼"],
    ["\\simeq", "≃"], ["\\cong", "≅"], ["\\propto", "∝"], ["\\ll", "≪"], ["\\gg", "≫"], ["\\subset", "⊂"],
    ["\\supset", "⊃"], ["\\subseteq", "⊆"], ["\\supseteq", "⊇"], ["\\in", "∈"], ["\\notin", "∉"], ["\\ni", "∋"],
    ["\\perp", "⊥"], ["\\parallel", "∥"], ["\\mid", "∣"],
  ]],
  ["Arrows", [
    ["\\to", "→"], ["\\leftarrow", "←"], ["\\rightarrow", "→"], ["\\Rightarrow", "⇒"], ["\\Leftarrow", "⇐"], ["\\Leftrightarrow", "⇔"],
    ["\\leftrightarrow", "↔"], ["\\uparrow", "↑"], ["\\downarrow", "↓"], ["\\Uparrow", "⇑"], ["\\Downarrow", "⇓"], ["\\mapsto", "↦"],
    ["\\hookrightarrow", "↪"], ["\\longrightarrow", "⟶"], ["\\longleftarrow", "⟵"],
  ]],
  ["Calculus", [
    ["\\int", "∫"], ["\\iint", "∬"], ["\\iiint", "∭"], ["\\oint", "∮"], ["\\sum", "∑"], ["\\prod", "∏"],
    ["\\coprod", "∐"], ["\\partial", "∂"], ["\\nabla", "∇"], ["\\infty", "∞"], ["\\sqrt{x}", "√x"], ["\\frac{a}{b}", "a/b"],
    ["\\lim", "lim"], ["\\sup", "sup"], ["\\inf", "inf"],
  ]],
  ["Logic & sets", [
    ["\\forall", "∀"], ["\\exists", "∃"], ["\\nexists", "∄"], ["\\neg", "¬"], ["\\land", "∧"], ["\\lor", "∨"],
    ["\\cap", "∩"], ["\\cup", "∪"], ["\\setminus", "∖"], ["\\emptyset", "∅"], ["\\varnothing", "⌀"], ["\\mathbb{R}", "ℝ"],
    ["\\mathbb{N}", "ℕ"], ["\\mathbb{Z}", "ℤ"], ["\\mathbb{Q}", "ℚ"], ["\\mathbb{C}", "ℂ"],
  ]],
  ["Misc & punctuation", [
    ["\\degree", "°"], ["\\angle", "∠"], ["\\triangle", "△"], ["\\square", "□"], ["\\diamond", "⋄"], ["\\dots", "…"],
    ["\\cdots", "⋯"], ["\\vdots", "⋮"], ["\\ddots", "⋱"], ["\\hbar", "ℏ"], ["\\ell", "ℓ"], ["\\Re", "ℜ"],
    ["\\Im", "ℑ"], ["\\aleph", "ℵ"], ["\\copyright", "©"], ["\\textregistered", "®"], ["\\texttrademark", "™"],
  ]],
  ["Accents (over a letter)", [
    ["\\hat{a}", "â"], ["\\bar{a}", "ā"], ["\\tilde{a}", "ã"], ["\\vec{a}", "→a"], ["\\dot{a}", "ȧ"], ["\\ddot{a}", "ä"],
    ["\\acute{a}", "á"], ["\\grave{a}", "à"], ["\\check{a}", "ǎ"], ["\\breve{a}", "ă"],
  ]],
  ["KherveTeX", [
    ["\\Kstroke", "Ꝁ"],
  ]],
]

export const TEXT_MODE_SYMBOLS = new Set(["\\Kstroke"])
