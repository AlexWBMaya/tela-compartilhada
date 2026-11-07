# Tela Compartilhada

Criei esse aplicativo como solução pro fato do compartilhamento de tela ter sido removido do Discord no Brasil. A ideia foi ter um jeito simples de continuar mostrando a tela e os jogos pros amigos enquanto a gente fica na call, sem precisar depender de plataformas pesadas ou cheias de burocracia.

Aproveitei pra fazer um programa direto ao ponto, portátil (só baixar e abrir) e focado em qualidade de imagem e taxa de quadros alta, sem puxar o áudio da própria chamada do Discord pra dentro da transmissão.

## O que ele faz

- **Salas por código (P2P):** Não precisa criar conta nem configurar servidor. É só colocar seu nome, digitar o mesmo código de sala que seus amigos e entrar. A conexão de vídeo é feita direto entre os computadores via WebRTC.
- **Qualidade destravada (60 e 120 FPS):** Dá pra escolher entre perfis prontos (de 720p leve até 1440p a 120 FPS) ou ajustar manualmente resolução (até 4K), FPS, bitrate (até 40 Mbps) e codec (H.264 usando a placa de vídeo, VP9 ou AV1).
- **Áudio isolado do jogo (sem capturar o Discord):** Mesmo compartilhando a tela inteira, o app usa um capturador próprio (WASAPI Process Loopback) que pega só o som da janela escolhida ou do jogo que está ativo no momento, ignorando o som do Discord pra ninguém se ouvir duplicado.
- **Você escolhe quem quer assistir:** Na barra lateral da sala aparecem todos os amigos conectados. Você pode abrir ou fechar a transmissão de cada um individualmente, mutar telas separadas ou entrar só pra assistir. Quando você fecha uma transmissão pra você, ela pausa de verdade pra não gastar sua placa de vídeo nem sua internet à toa.
- **Modo Overlay para jogos:** O app pode virar uma janelinha flutuante que fica por cima do jogo, com controle de opacidade e opção de travar o clique (o mouse atravessa o vídeo e clica direto no jogo).
- **Controle remoto com permissão:** Se você quiser deixar um amigo mexer no seu PC pela transmissão, ele pode pedir permissão. Você aprova na tela e pode cortar o acesso na mesma hora com um atalho no teclado. Tudo roda usando a API nativa do Windows, sem precisar instalar driver extra.
- **Economia de GPU:** Opção de esconder a prévia da sua própria tela pra não renderizar o vídeo duas vezes na sua máquina enquanto você joga.
- **Atualização em 1 clique:** Quando sai uma versão nova aqui no GitHub, aparece um botão no topo do programa que baixa, substitui o executável e reabre o app sozinho.

## Pontos negativos e limitações

Como é um projeto caseiro e sem servidores pagos por trás, ele tem algumas limitações importantes:

- **Consumo de upload em salas cheias (P2P):** Como o vídeo vai direto do seu PC pro PC de quem está assistindo (sem um servidor central redistribuindo), cada amigo que abre a sua transmissão consome uma fatia a mais do seu upload e da sua placa de vídeo. Se muita gente assistir sua tela ao mesmo tempo, vale baixar o preset pro modo Leve.
- **Não tem chat de voz integrado:** O programa serve exclusivamente pra compartilhar a tela e o som do jogo. Pra conversar por voz, ainda precisa deixar a call do Discord (ou outro programa) aberta no fundo.
- **Pode ter bloqueio de rede (NAT / CGNAT):** Em algumas operadoras de internet com bloqueio mais fechado, a conexão direta entre dois computadores pode falhar por não ter um servidor intermediário (TURN) pago.
- **Depende do servidor público do PeerJS pra conectar:** O vídeo não passa por servidor nenhum, mas o "encontro" inicial da sala usa o servidor gratuito do PeerJS. Se esse serviço estiver fora do ar ou instável no dia, pode demorar pra achar a sala.
- **Linux (AppImage) tem algumas diferenças:** Existe uma versão nativa `TelaCompartilhada.AppImage` (sem Wine/Proton), com atualização em 1 clique e compatível com salas de quem usa Windows. Limitações no Linux: o controle remoto depende do `xdotool` instalado (X11/XWayland) e o áudio do jogo/janela ainda não é capturado. Não tem versão pra Mac ou celular.
- **Aviso do Windows Defender na primeira vez:** Como o executável não tem assinatura digital paga da Microsoft, o Windows SmartScreen pode exibir a tela de "O Windows protegeu o computador" quando você baixa. É só clicar em "Mais informações" e depois em "Executar assim mesmo".

## Como baixar e usar

Se você só quer usar o programa com seus amigos, não precisa mexer com código:

1. Vá na aba [Releases](https://github.com/AlexWBMaya/tela-compartilhada/releases) aqui do repositório.
2. Baixe o arquivo `TelaCompartilhada.exe` da versão mais recente.
3. Abra o arquivo, escolha seu nome, digite o código da sala combinado com seus amigos e clique em **Entrar**.

Por ser portátil, não precisa instalar nada no Windows.

**Linux:** baixe `TelaCompartilhada.AppImage` na mesma página, dê permissão de execução (`chmod +x TelaCompartilhada.AppImage`) e abra. Depois disso, as atualizações também são em 1 clique.

## Atalhos de teclado

Os atalhos funcionam mesmo quando você está dentro de um jogo em tela cheia ou janela sem borda:

- `Alt + Shift + O` — Ativa ou sai do modo Overlay.
- `Alt + Shift + L` — Trava ou destrava os cliques do mouse no Overlay (faz o clique atravessar pro jogo).
- `Alt + Shift + H` — Esconde ou mostra a janela do aplicativo rapidamente.
- `Alt + Shift + M` — Muta ou desmuta o som de todas as transmissões abertas.
- `Alt + Shift + K` — Corta na hora o controle remoto, caso alguém esteja controlando seu PC.

## Como rodar pelo código-fonte

Se quiser testar ou modificar o projeto localmente, você vai precisar do [Node.js](https://nodejs.org/) instalado no Windows.

```bash
# Clonar o repositório
git clone https://github.com/AlexWBMaya/tela-compartilhada.git
cd tela-compartilhada

# Instalar as dependências
npm install

# Abrir o aplicativo
npm start
```

Para abrir com o painel de desenvolvedor (DevTools) ativo:

```bash
npm run dev
```

Para gerar um novo executável portátil (`dist/TelaCompartilhada.exe`):

```bash
npm run build-exe
```

## Como foi construído

- **Electron:** Estrutura da janela, captura de telas/janelas, overlay transparente e flags de aceleração por hardware (GPU encode/decode e zero-copy).
- **WebRTC + PeerJS:** Conexão mesh P2P para vídeo, áudio e canal de dados (sincronização da sala, lista de participantes e comandos de controle remoto).
- **C# (.NET nativo do Windows) + AudioWorklet:** O arquivo `src/audio-loopback-worker.cs` é compilado automaticamente na primeira execução usando o `csc.exe` que já vem no Windows. Ele captura o áudio PCM apenas do processo do jogo via WASAPI e envia para o WebRTC sem depender de bibliotecas externas.
- **PowerShell + User32.dll:** Usado em segundo plano para traduzir os eventos de mouse e teclado do controle remoto direto para o sistema operacional sem instalar drivers de terceiros.

## Licença

Distribuído sob a licença MIT.
