# Confere que cada handler é declarado no MESMO componente onde é usado.
# Meluni.jsx já quebrou 4x por isso (dispMsg, abrirModalTemplates,
# alternarAutoCarrinho, toggleAuto) — agora vira teste antes do push.
import re, sys
src = open('src/Meluni.jsx').read().split('\n')
comps = [(i, re.match(r'function (Secao\w+|\w+Tab)\(', l).group(1))
         for i, l in enumerate(src) if re.match(r'function (Secao\w+|\w+Tab)\(', l)]
def dono(linha):
    atual = '(topo)'
    for i, nome in comps:
        if i <= linha: atual = nome
        else: break
    return atual
decl, uso, erros = {}, {}, []
for i, l in enumerate(src):
    for m in re.finditer(r'const (\w+) = (?:async )?\(|const \[(\w+),', l):
        nome = m.group(1) or m.group(2)
        decl.setdefault((dono(i), nome), i)
    for m in re.finditer(r'onClick=\{(\w+)\}|disabled=\{(\w+)', l):
        nome = m.group(1) or m.group(2)
        # props (onClose, onAbrir...) chegam de fora — não são handler local
        if nome and nome[0].islower() and not re.match(r'^on[A-Z]', nome):
            uso.setdefault((dono(i), nome), i)
for (comp, nome), linha in uso.items():
    daFuncao = any(nome in src[i] for i, c in comps if c == comp)   # veio como prop?
    if (comp, nome) not in decl and ('(topo)', nome) not in decl and not daFuncao:
        erros.append(f'  {nome} usado em {comp} (linha {linha+1}) sem declaracao nesse escopo')
if erros:
    print('ESCOPO QUEBRADO:'); print('\n'.join(erros)); sys.exit(1)
print('escopo ok — handlers declarados no componente certo')
