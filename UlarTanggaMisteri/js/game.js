const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 1000;
canvas.height = 1000;
const gridSize = 10;
const cellSize = canvas.width / gridSize;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// =========================================
// MENGAMBIL DATA PEMAIN & RESET AMAN
// =========================================
let savedSetup = null;
try { savedSetup = JSON.parse(sessionStorage.getItem('gameSetup')); } catch (e) {}

let initialPlayers = (savedSetup && savedSetup.length > 0) ? savedSetup : [
    { id: 0, avatar: "👦🏻", name: "P1 (Kamu)", color: "#3498db", isBot: false },
    { id: 1, avatar: "🤖", name: "P2 (Bot)", color: "#e74c3c", isBot: true },
    { id: 2, avatar: "🤖", name: "P3 (Bot)", color: "#2ecc71", isBot: true },
    { id: 3, avatar: "🤖", name: "P4 (Bot)", color: "#f1c40f", isBot: true }
];

let players = initialPlayers.map((p, index) => ({
    ...p, id: index, pos: 1, renderCoords: null, inventory: [], savedInventory: [],
    buffs: {shield:0, diceMult:1, immuneTurns:0, rerollSmall:0, extraTurn:0}, 
    debuffs: {frozen:0, reverse:0, brokenDice:0, cardLocked:0, fakeLadder:0}, 
    lastPreLadder: 1, godModeActive: false
}));

let ladders = {}; let snakes = {}; let chests = [];

function generateRandomMap() {
    ladders = {}; snakes = {}; chests = [];
    let usedSquares = new Set([1, 100]); 
    const getRow = (pos) => Math.floor((pos - 1) / 10);
    const getCol = (pos) => { let row = getRow(pos); let col = (pos - 1) % 10; return row % 2 !== 0 ? 9 - col : col; };

    for (let i = 0; i < 5; i++) {
        let start, end, attempts = 0;
        do {
            start = Math.floor(Math.random() * 70) + 2; 
            let startRow = getRow(start); let startCol = getCol(start);
            let jumpRows = Math.floor(Math.random() * 3) + 2; 
            let endRow = Math.min(9, startRow + jumpRows);
            let minCol = Math.max(0, startCol - 3); let maxCol = Math.min(9, startCol + 3);
            let endCol = Math.floor(Math.random() * (maxCol - minCol + 1)) + minCol;
            let actualEndCol = endRow % 2 !== 0 ? 9 - endCol : endCol;
            end = (endRow * 10) + actualEndCol + 1;
            if (end > 99) end = 99; attempts++;
        } while ((usedSquares.has(start) || usedSquares.has(end) || start >= end) && attempts < 100);
        if (attempts < 100) { usedSquares.add(start); usedSquares.add(end); ladders[start] = end; }
    }

    for (let i = 0; i < 5; i++) {
        let start, end, attempts = 0;
        do {
            start = Math.floor(Math.random() * 78) + 21; 
            let startRow = getRow(start); let startCol = getCol(start);
            let dropRows = Math.floor(Math.random() * 3) + 2; 
            let endRow = Math.max(0, startRow - dropRows);
            let minCol = Math.max(0, startCol - 3); let maxCol = Math.min(9, startCol + 3);
            let endCol = Math.floor(Math.random() * (maxCol - minCol + 1)) + minCol;
            let actualEndCol = endRow % 2 !== 0 ? 9 - endCol : endCol;
            end = (endRow * 10) + actualEndCol + 1;
            if (end < 2) end = 2; attempts++;
        } while ((usedSquares.has(start) || usedSquares.has(end) || start <= end) && attempts < 100);
        if (attempts < 100) { usedSquares.add(start); usedSquares.add(end); snakes[start] = end; }
    }

    for (let i = 0; i < 25; i++) {
        let pos, attempts = 0;
        do { pos = Math.floor(Math.random() * 98) + 2; attempts++; } while (usedSquares.has(pos) && attempts < 100);
        if (attempts < 100) { usedSquares.add(pos); chests.push(pos); }
    }
}

// =========================================
// SISTEM AUDIO (DENGAN MUSIK DEFAULT)
// =========================================
const Sound = {
    ctx: null, bgm: null, enabled: true,
    init: function() {
        if (!this.enabled) return;
        try {
            if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.ctx.state === 'suspended') this.ctx.resume();
            
            let isBgmOn = localStorage.getItem('utm_bgm') !== 'false';
            if (isBgmOn && !this.bgm) {
                // Musik default Kevin MacLeod yang asik
                this.bgm = new Audio('Pirates.mp3');
                this.bgm.loop = true; this.bgm.volume = 0.25; 
                this.bgm.play().catch(e => { console.log("BGM menunggu klik"); });
            } else if (!isBgmOn && this.bgm) {
                this.bgm.pause(); this.bgm = null;
            }
        } catch (e) { console.warn("Audio Context ditolak oleh browser."); this.enabled = false; }
    },
    playTone: function(freq, type, duration, vol=0.1) {
        if (!this.enabled || !this.ctx || localStorage.getItem('utm_sfx') === 'false') return; 
        try {
            let osc = this.ctx.createOscillator(); let gain = this.ctx.createGain();
            osc.type = type; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(); osc.stop(this.ctx.currentTime + duration);
        } catch(e) {}
    },
    playNoise: function(duration, type='lowpass') {
        if (!this.enabled || !this.ctx || localStorage.getItem('utm_sfx') === 'false') return; 
        try {
            let bufSize = this.ctx.sampleRate * duration; let buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
            let data = buffer.getChannelData(0); for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
            let noise = this.ctx.createBufferSource(); noise.buffer = buffer;
            let filter = this.ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = (type === 'lowpass') ? 400 : 2000;
            let gain = this.ctx.createGain(); gain.gain.setValueAtTime(0.5, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
            noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination); noise.start();
        } catch(e) {}
    },
    step: function() { this.playTone(350, 'sine', 0.1, 0.1); },
    dice: function() { let i=0; let int=setInterval(()=>{this.playTone(600+Math.random()*400,'square',0.05,0.05); if(++i>8)clearInterval(int);},50);},
    getCard: function() { this.playTone(523.25,'sine',0.1,0.15); setTimeout(()=>this.playTone(659.25,'sine',0.2,0.15),100); setTimeout(()=>this.playTone(783.99,'sine',0.4,0.15),200);},
    useGood: function() { this.playTone(440,'triangle',0.1,0.15); setTimeout(()=>this.playTone(880,'triangle',0.4,0.15),150);},
    useBad: function() { this.playTone(300,'sawtooth',0.2,0.15); setTimeout(()=>this.playTone(200,'sawtooth',0.4,0.15),150);},
    ladder: function() { for(let i=0; i<6; i++) setTimeout(()=>this.playTone(300+i*80,'sine',0.1,0.1),i*80);},
    snake: function() { for(let i=0; i<8; i++) setTimeout(()=>this.playTone(450-i*30,'sawtooth',0.1,0.1),i*80);},
    thunder: function() { this.playNoise(1.5, 'highpass'); },
    earthquake: function() { this.playNoise(2.5, 'lowpass'); },
    
    // MUSIK KEMENANGAN EPIK ALA FANFARE
    win: function() { 
        if (this.bgm) { this.bgm.pause(); } 
        if (!this.enabled || !this.ctx || localStorage.getItem('utm_sfx') === 'false') return; 
        const notes = [{f:523.25, d:0.15, t:0}, {f:523.25, d:0.15, t:150}, {f:523.25, d:0.15, t:300}, {f:523.25, d:0.40, t:450}, {f:415.30, d:0.40, t:900}, {f:466.16, d:0.40, t:1350}, {f:523.25, d:0.15, t:1800}, {f:466.16, d:0.15, t:1950}, {f:523.25, d:0.80, t:2100}];
        notes.forEach(n => setTimeout(() => this.playTone(n.f, 'square', n.d, 0.2), n.t));
    }
};

// AUTO-PLAY AUDIO SAAT KLIK PERTAMA
document.body.addEventListener('click', () => { try { Sound.init(); } catch(e){} }, { once: true });

// FUNGSI TOGGLE MUSIK DARI TOMBOL UI
function toggleIngameBGM() {
    let isBgmOn = localStorage.getItem('utm_bgm') !== 'false';
    isBgmOn = !isBgmOn; 
    localStorage.setItem('utm_bgm', isBgmOn); 
    
    let btn = document.getElementById('btn-toggle-bgm');
    if (isBgmOn) {
        if(btn) btn.innerHTML = '🎵<br><span>MUSIK</span>';
        Sound.init(); 
        if(Sound.bgm) Sound.bgm.play().catch(e=>{});
    } else {
        if(btn) btn.innerHTML = '🔇<br><span>MATI</span>';
        if (Sound.bgm) { Sound.bgm.pause(); Sound.bgm = null; }
    }
}


// =========================================
// UI MODAL INFO & LAYAR KEMENANGAN
// =========================================
function openInfo() { document.getElementById('info-modal').style.display = 'flex'; }
function closeInfo() { document.getElementById('info-modal').style.display = 'none'; }

function showVictoryScreen(playerName) {
    Sound.win(); 
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed'; overlay.style.top = '0'; overlay.style.left = '0';
    overlay.style.width = '100%'; overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.85)'; overlay.style.zIndex = '9999';
    overlay.style.display = 'flex'; overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center'; overlay.style.alignItems = 'center';
    overlay.style.color = 'white'; overlay.style.animation = 'fadeinout 1s forwards';
    
    overlay.innerHTML = `
        <h1 style="font-size: 5rem; color: #f1c40f; text-shadow: 0 6px 0 #d35400; font-family: 'Lilita One', cursive; margin-bottom: 10px; text-align: center;">🎉 SELAMAT! 🎉</h1>
        <h2 style="font-size: 2rem; margin-bottom: 40px; text-align: center; font-family: 'Nunito', sans-serif;">${playerName} Menemukan Harta Karun!</h2>
        <button onclick="window.location.href='index.html'" style="padding: 15px 40px; font-size: 1.5rem; font-family: 'Lilita One', cursive; background: #2ecc71; border: 4px solid #27ae60; border-radius: 15px; color: white; cursor: pointer; box-shadow: 0 5px 0 #27ae60; transition: 0.2s;">🏆 MENU UTAMA</button>
    `;
    document.body.appendChild(overlay);
}

// =========================================
// DATABASE KARTU & LOGIKA
// =========================================
const cardsData = [
    { id: 'c1', name: "Mode Dewa", desc: "Pilih 1 dari semua!", type: "good", icon: "👼", apply: async (user) => { 
        showToast(`${user.name} mengaktifkan Mode Dewa! Pilih 1 kartu yang kamu inginkan!`); 
        user.savedInventory = [...user.inventory]; 
        user.inventory = cardsData.filter(c => c.id !== 'c1').sort(() => Math.random() - 0.5); 
        user.godModeActive = true; updateUI(); 
    }},
    { id: 'c2', name: "Naik Tangga", desc: "Maju ke tangga terdekat", type: "good", icon: "🪜", apply: async (user) => { showToast(`${user.name} mencari tangga terdekat!`); let nextL = findNextLadder(user.pos); await glidePlayer(user, user.pos, nextL, 800, false); await climbIfLadder(user); }},
    { id: 'c3', name: "Anti Ular", desc: "Kebal ular 1x", type: "good", icon: "🛡️", apply: async (user) => { user.buffs.shield = 1; showToast(`${user.name} mengaktifkan Anti Ular!`); } },
    { id: 'c4', name: "Double Dice", desc: "Dadu x2 giliran ini", type: "good", icon: "🎲x2", apply: async (user) => { user.buffs.diceMult = 2; showToast(`${user.name} mengaktifkan Double Dice!`); } },
    { id: 'c5', name: "Triple Dice", desc: "Dadu x3 giliran ini", type: "good", icon: "🎲x3", apply: async (user) => { user.buffs.diceMult = 3; showToast(`${user.name} mengaktifkan Triple Dice!`); } },
    { id: 'c6', name: "Teleport 10", desc: "Maju 10 petak", type: "good", icon: "🚀", apply: async (user) => { showToast(`${user.name} Teleport maju 10 petak!`); let targetPos = Math.min(100, user.pos + 10); await glidePlayer(user, user.pos, targetPos, 1000, true); }},
    { id: 'c7', name: "Lompat Ular", desc: "Lewati ular", type: "good", icon: "🦘", apply: async (user) => { user.buffs.shield = 1; showToast(`${user.name} siap melompati ular!`); } }, 
    { id: 'c8', name: "Perisai Dewa", desc: "Kebal jebakan 2x", type: "good", icon: "🔮", apply: async (user) => { user.buffs.immuneTurns = 2; showToast(`${user.name} mengaktifkan Perisai Keberuntungan!`); } },
    { id: 'c9', name: "Putar Ulang", desc: "Reroll jika < 4", type: "good", icon: "🔄", apply: async (user) => { user.buffs.rerollSmall = 1; showToast(`${user.name} akan memutar ulang dadu kecil!`); } },
    { id: 'c10', name: "Tangga Emas", desc: "Ke tangga tertinggi", type: "good", icon: "🌟", apply: async (user) => { 
        let bestLadderStart = 1, bestLadderEnd = 1;
        for (let s in ladders) { if (ladders[s] > bestLadderEnd) { bestLadderEnd = ladders[s]; bestLadderStart = parseInt(s); } }
        showToast(`${user.name} terbang ke Tangga Emas!`); 
        await glidePlayer(user, user.pos, bestLadderStart, 1500, false); await climbIfLadder(user); 
    }}, 
    { id: 'c11', name: "Bonus Giliran", desc: "Main 2x beruntun", type: "good", icon: "➕", apply: async (user) => { user.buffs.extraTurn = 1; showToast(`${user.name} dapat giliran tambahan!`); } },
    { id: 'c12', name: "Hadiah Misteri", desc: "Dapat 2 kartu acak", type: "good", icon: "🎁", apply: async (user) => { drawCard(user); drawCard(user); showToast(`${user.name} membuka 2 hadiah misterius!`); } },
    { id: 'c13', name: "Kutukan Ular", desc: "Lawan turun 10", type: "bad", icon: "🐍", apply: async (user, target) => { showToast(`${user.name} mengutuk ${target.name} mundur 10 petak!`); await walkPlayer(target, -10); }},
    { id: 'c14', name: "Freeze", desc: "Lawan beku 1x", type: "bad", icon: "❄️", apply: async (user, target) => { target.debuffs.frozen = 1; showToast(`${target.name} dibekukan oleh ${user.name}!`); } },
    { id: 'c15', name: "Mundur Dadu", desc: "Jalan lawan mundur", type: "bad", icon: "🔙", apply: async (user, target) => { target.debuffs.reverse = 1; showToast(`Dadu ${target.name} dikutuk untuk mundur!`); } },
    { id: 'c16', name: "Hujan Petir", desc: "Semua mundur 3", type: "bad", icon: "⛈️", apply: async (user) => { 
        Sound.thunder(); showToast(`Hujan petir menyambar! Semua mundur 3 petak!`); 
        let moves = players.map(p => {
            if (p.buffs.immuneTurns > 0) { p.buffs.immuneTurns--; showToast(`${p.name} menangkis dengan Perisai Dewa! 🔮`); return Promise.resolve(); }
            return walkPlayer(p, -3);
        });
        await Promise.all(moves); 
    }},
    { id: 'c17', name: "Racun Ular", desc: "Lawan beku 2x", type: "bad", icon: "🧪", apply: async (user, target) => { target.debuffs.frozen = 2; showToast(`${target.name} terkena racun dan beku 2 giliran!`); } },
    { id: 'c18', name: "Dadu Rusak", desc: "Dadu lawan maks 3", type: "bad", icon: "💥", apply: async (user, target) => { target.debuffs.brokenDice = 1; showToast(`Dadu ${target.name} dirusak! Maksimal 3!`); } },
    { id: 'c19', name: "Badai Pasir", desc: "Lawan mundur 5", type: "bad", icon: "🌪️", apply: async (user, target) => { showToast(`Badai pasir menerbangkan ${target.name} mundur!`); await walkPlayer(target, -5); }},
    { id: 'c20', name: "Kutukan Gelap", desc: "Hapus 1 kartu acak", type: "bad", icon: "🌑", apply: async (user, target) => { if(target.inventory.length > 0){ let randIdx = Math.floor(Math.random() * target.inventory.length); target.inventory.splice(randIdx, 1); showToast(`Satu kartu milik ${target.name} hangus secara acak!`);} else {showToast(`${target.name} tidak membawa kartu!`);} }},
    { id: 'c21', name: "Jaring Laba", desc: "Kunci kartu 2x", type: "bad", icon: "🕸️", apply: async (user, target) => { target.debuffs.cardLocked = 2; showToast(`Kartu ${target.name} tersangkut Jaring Laba-Laba!`); } },
    { id: 'c22', name: "Tangga Palsu", desc: "Jebak tangga lawan", type: "bad", icon: "💔", apply: async (user, target) => { target.debuffs.fakeLadder = 1; showToast(`${target.name} terkena kutukan Tangga Palsu!`); } },
    { id: 'c23', name: "Gempa Bumi", desc: "Semua mundur 5", type: "bad", icon: "🫨", apply: async (user) => { 
        Sound.earthquake(); showToast(`BUMI BERGONCANG! Semua mundur 5 petak!`); 
        let moves = players.map(p => {
            if (p.buffs.immuneTurns > 0) { p.buffs.immuneTurns--; showToast(`${p.name} menangkis gempa dengan Perisai Dewa! 🔮`); return Promise.resolve(); }
            return walkPlayer(p, -5);
        });
        await Promise.all(moves); 
    }},
    { id: 'c24', name: "Serangan Naga", desc: "Lawan jatuh ke bawah", type: "bad", icon: "🐉", apply: async (user, target) => { showToast(`Naga menyerang ${target.name} dan menjatuhkannya!`); let dropPos = target.lastPreLadder || Math.max(1, target.pos - 15); await glidePlayer(target, target.pos, dropPos, 1500, false); }}
];

let turnIndex = 0; let isAnimating = false;

function init() { 
    generateRandomMap(); 
    const statsContainer = document.getElementById('player-stats-container');
    statsContainer.innerHTML = '';
    players.forEach(p => {
        statsContainer.innerHTML += `
            <div class="player-card" id="stat-p${p.id}">
                <div class="avatar">${p.avatar}</div>
                <div class="name" style="color: ${p.color};">${p.name}</div>
                <div class="pos">Pos: <span id="pos-p${p.id}">1</span></div>
                <div class="status-icons" id="status-p${p.id}"></div>
            </div>
        `;
    });

    drawBoard(); 
    
    // Set icon musik berdasarkan localStorage
    let isBgmOn = localStorage.getItem('utm_bgm') !== 'false';
    let btnMusic = document.getElementById('btn-toggle-bgm');
    if(btnMusic) { btnMusic.innerHTML = isBgmOn ? '🎵<br><span>MUSIK</span>' : '🔇<br><span>MATI</span>'; }
    
    updateUI(); 

    if (players[turnIndex].isBot) {
        setTimeout(() => botLogic(players[turnIndex]), 1500);
    }
}

function getCoords(pos) {
    let row = Math.floor((pos - 1) / 10);
    let col = (pos - 1) % 10;
    if (row % 2 !== 0) col = 9 - col;
    return { cx: (col * cellSize) + (cellSize/2), cy: ((9 - row) * cellSize) + (cellSize/2), x: col * cellSize, y: (9 - row) * cellSize };
}

function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 1; i <= 100; i++) {
        let c = getCoords(i);
        let row = Math.floor((i - 1) / 10), col = (i - 1) % 10;
        ctx.fillStyle = (row + col) % 2 === 0 ? "#FFECB3" : "#FFCC80";
        ctx.fillRect(c.x, c.y, cellSize, cellSize);
        ctx.strokeStyle = "rgba(139, 90, 43, 0.2)"; ctx.lineWidth = 2; ctx.strokeRect(c.x, c.y, cellSize, cellSize);
        ctx.fillStyle = "rgba(100, 70, 50, 0.8)"; ctx.font = "bold 26px Nunito, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(i, c.x + 8, c.y + 8);
    }

    for (let s in ladders) {
        let start = getCoords(s), end = getCoords(ladders[s]);
        let dx = end.cx - start.cx; let dy = end.cy - start.cy;
        let len = Math.sqrt(dx*dx + dy*dy); let angle = Math.atan2(dy, dx);
        ctx.save(); ctx.translate(start.cx, start.cy); ctx.rotate(angle);
        ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 14; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(4, -14); ctx.lineTo(len+4, -14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(4, 22); ctx.lineTo(len+4, 22); ctx.stroke();
        ctx.strokeStyle = "#5D4037"; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(len, -18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 18); ctx.lineTo(len, 18); ctx.stroke();
        ctx.lineWidth = 7; ctx.strokeStyle = "#795548";
        for (let j = 24; j < len-10; j += 32) { ctx.beginPath(); ctx.moveTo(j, -18); ctx.lineTo(j, 18); ctx.stroke(); }
        ctx.restore();
    }

    for (let s in snakes) {
        let start = getCoords(s), end = getCoords(snakes[s]);
        let dx = end.cx - start.cx; let dy = end.cy - start.cy;
        let len = Math.sqrt(dx*dx + dy*dy);
        let nx = -dy / len; let ny = dx / len;
        let bellyDir = (parseInt(s) % 2 === 0 ? 1 : -1);
        let bellySize = Math.min(80, len * 0.25) * bellyDir; 
        let midX = (start.cx + end.cx) / 2 + nx * bellySize; 
        let midY = (start.cy + end.cy) / 2 + ny * bellySize;

        ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 28; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(start.cx+6, start.cy+6); ctx.quadraticCurveTo(midX+6, midY+6, end.cx+6, end.cy+6); ctx.stroke();
        ctx.strokeStyle = "#1B5E20"; ctx.lineWidth = 24; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(start.cx, start.cy); ctx.quadraticCurveTo(midX, midY, end.cx, end.cy); ctx.stroke();
        ctx.strokeStyle = "#4CAF50"; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(start.cx, start.cy); ctx.quadraticCurveTo(midX, midY, end.cx, end.cy); ctx.stroke();
        ctx.font = "45px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🐲", start.cx, start.cy);
    }

    ctx.font = "40px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    chests.forEach(pos => { 
        let c = getCoords(pos); 
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)"; ctx.beginPath(); ctx.arc(c.cx, c.cy, 22, 0, Math.PI*2); ctx.fill();
        ctx.fillText("📦", c.cx, c.cy + 4); 
    });
    
    players.forEach(p => {
        let c = p.renderCoords ? p.renderCoords : getCoords(p.pos);
        let offset = [ {x:-20,y:-20}, {x:20,y:-20}, {x:-20,y:20}, {x:20,y:20} ][p.id];
        ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.arc(c.cx + offset.x + 3, c.cy + offset.y + 3, 20, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(c.cx + offset.x, c.cy + offset.y, 20, 0, Math.PI*2); ctx.fillStyle = p.color; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = "#ffffff"; ctx.stroke();
    });
}

function glidePlayer(player, startPos, endPos, duration, isHopping = false) {
    return new Promise(resolve => {
        let start = getCoords(startPos); let end = getCoords(endPos);
        let startTime = null;
        function anim(time) {
            if (!startTime) startTime = time;
            let p = Math.min((time - startTime) / duration, 1);
            let cx = start.cx + (end.cx - start.cx) * p; let cy = start.cy + (end.cy - start.cy) * p;
            if (isHopping) cy -= Math.sin(p * Math.PI) * 30; 
            player.renderCoords = { cx, cy }; drawBoard();
            if (p < 1) requestAnimationFrame(anim);
            else { player.renderCoords = null; player.pos = endPos; drawBoard(); resolve(); }
        }
        requestAnimationFrame(anim);
    });
}

// LOGIKA JALAN & PANTULAN
async function walkPlayer(player, steps) {
    if (steps === 0) return;
    let direction = steps > 0 ? 1 : -1; 
    let remaining = Math.abs(steps);
    
    while (remaining > 0) {
        let startPos = player.pos; 
        let nextPos = player.pos + direction;
        
        if (nextPos > 100) { direction = -1; nextPos = 99; } 
        else if (nextPos < 1) { nextPos = 1; }
        
        Sound.step(); 
        await glidePlayer(player, startPos, nextPos, 250, true); 
        
        if (nextPos === 1 && direction === -1) break;
        
        remaining--;
    }
}

const diceFaces = ["⚀","⚁","⚂","⚃","⚄","⚅"];

let stuckCounter = 0;
document.getElementById('dice-btn').addEventListener('click', () => {
    try { Sound.init(); } catch(e){} 
    let p = players[turnIndex];
    
    if (isAnimating) {
        stuckCounter++; if(stuckCounter > 5) { isAnimating = false; stuckCounter = 0; }
        return; 
    }
    stuckCounter = 0;
    
    if (p.godModeActive) { showToast("Pilih 1 kartu Mode Dewa dulu!"); return; }
    if (p.isBot) return; 
    
    processTurn(p);
});

async function processTurn(player) {
    if (player.debuffs.frozen > 0) { player.debuffs.frozen--; showToast(`${player.name} membeku, kehilangan giliran!`); nextTurn(); return; }
    
    isAnimating = true; 
    
    let roll = Math.floor(Math.random() * 6) + 1;
    if (player.debuffs.brokenDice > 0) { roll = Math.min(3, roll); player.debuffs.brokenDice--; }
    if (player.buffs.rerollSmall > 0 && roll < 4) { roll = Math.floor(Math.random() * 3) + 4; player.buffs.rerollSmall--; showToast(`${player.name} memutar ulang dadu!`);}
    
    let finalMove = roll;
    if (player.buffs.diceMult > 1) { finalMove *= player.buffs.diceMult; player.buffs.diceMult = 1; }
    if (player.debuffs.reverse > 0) { finalMove = -finalMove; player.debuffs.reverse--; }
    
    Sound.dice(); 
    for (let i = 0; i < 10; i++) { document.getElementById('dice-display').innerText = diceFaces[Math.floor(Math.random()*6)]; await sleep(50); }
    document.getElementById('dice-display').innerText = (roll <= 6 && roll >= 1) ? diceFaces[roll-1] : "🎲";
    
    await walkPlayer(player, finalMove); updateUI(); await sleep(200); await checkTile(player);
}

async function checkTile(p) {
    if (ladders[p.pos]) await climbIfLadder(p); 
    else if (snakes[p.pos]) {
        if (p.buffs.shield > 0) { p.buffs.shield--; Sound.useGood(); showToast(`${p.name} kebal gigitan ular! 🛡️`); } 
        else { Sound.snake(); showToast(`Aduh! ${p.name} tergigit ular. 🐍`); await glidePlayer(p, p.pos, snakes[p.pos], 800, false); }
    } else if (chests.includes(p.pos)) drawCard(p); 
    
    drawBoard(); updateUI();
    
    if (p.pos === 100) { showVictoryScreen(p.name); return; }
    
    await sleep(600); 
    if (p.buffs.extraTurn > 0) { p.buffs.extraTurn--; isAnimating = false; showToast(`${p.name} dapat Bonus Giliran!`); if(p.isBot) botLogic(p); } else { nextTurn(); }
}

async function climbIfLadder(p) {
    if(ladders[p.pos]){
        p.lastPreLadder = p.pos; let endPos = ladders[p.pos];
        if (p.debuffs.fakeLadder > 0) {
            p.debuffs.fakeLadder--; showToast(`Itu Tangga Palsu! ${p.name} merosot 5 petak! 💔`);
            Sound.ladder(); await glidePlayer(p, p.pos, endPos, 600, false);
            await sleep(200); Sound.useBad(); await glidePlayer(p, endPos, Math.max(1, endPos - 5), 500, false);
        } else { Sound.ladder(); showToast(`${p.name} menaiki tangga! 🪜`); await glidePlayer(p, p.pos, endPos, 800, false); }
    }
}

function drawCard(p) { 
    Sound.getCard(); 
    let card = cardsData[Math.floor(Math.random() * cardsData.length)]; 
    if (p.godModeActive) p.savedInventory.push(card);
    else p.inventory.push(card); 
    showToast(`📦 ${p.name} mendapat kartu: ${card.name}!`); 
}

function findNextLadder(currentPos) { for (let s in ladders) { if (parseInt(s) > currentPos) return parseInt(s); } return currentPos; }
function getLeadingEnemy(user) { let enemies = players.filter(p => p.id !== user.id); return enemies.reduce((prev, curr) => (prev.pos > curr.pos) ? prev : curr); }

function playCardAnimation(card, callback) {
    const overlay = document.getElementById('effect-overlay');
    const boardWrapper = document.querySelector('.board-wrapper');
    if (card.type === 'good') Sound.useGood(); else Sound.useBad();
    overlay.className = 'active';
    if (card.id === 'c16') boardWrapper.classList.add('anim-flash'); 
    if (card.id === 'c23') boardWrapper.classList.add('anim-shake'); 
    overlay.innerHTML = `<div class="anim-popup"><div style="font-size: 6rem; line-height: 1;">${card.icon}</div><div style="font-size: 1.8rem; font-family: 'Lilita One'; color: #fff; -webkit-text-stroke: 2px #3a2311;">${card.name.toUpperCase()}</div></div>`;
    setTimeout(() => { overlay.className = ''; overlay.innerHTML = ''; boardWrapper.classList.remove('anim-shake', 'anim-flash'); callback(); }, 1500);
}

function activateCard(playerIndex, cardIndex) {
    let p = players[playerIndex];
    if (p.debuffs.cardLocked > 0) { Sound.useBad(); showToast(`Kartumu terkunci Jaring Laba-laba! 🕸️`); return; }
    
    isAnimating = true; 
    let card = p.inventory[cardIndex]; 
    p.inventory.splice(cardIndex, 1); 
    
    let usedGodModeCard = false;
    if (card.id !== 'c1' && p.godModeActive) {
        p.godModeActive = false;
        p.inventory = p.savedInventory || [];
        usedGodModeCard = true;
    }
    
    updateUI(); 
    
    let target = null;
    if (!(card.type === "good" || card.id === "c16" || card.id === "c23")) target = getLeadingEnemy(p);
    
    playCardAnimation(card, async () => {
        if (card.id === "c16" || card.id === "c23" || card.type === "good") {
            await card.apply(p); 
        } else { 
            if (target.buffs.immuneTurns > 0) { 
                target.buffs.immuneTurns--; 
                Sound.useGood(); showToast(`${target.name} menangkis dengan Perisai Dewa! 🔮`); 
            } else {
                await card.apply(p, target); 
            }
        }
        
        if (usedGodModeCard) showToast(`Kekuatan Mode Dewa telah selesai digunakan!`);

        drawBoard(); updateUI();
        isAnimating = false; 

        let winner = players.find(x => x.pos === 100);
        if (winner) { setTimeout(() => { showVictoryScreen(winner.name); }, 500); }
    });
}

function usePlayerCard(cardIndex) { 
    if (isAnimating) { stuckCounter++; if(stuckCounter > 5) isAnimating = false; return; }
    if (players[turnIndex].isBot) return; 
    activateCard(turnIndex, cardIndex); 
}

function botLogic(bot) {
    if (!bot.isBot) return;
    setTimeout(() => {
        if (bot.inventory.length > 0 && bot.debuffs.cardLocked <= 0 && Math.random() > 0.5) {
            activateCard(bot.id, 0); setTimeout(() => processTurn(bot), 2500); 
        } else setTimeout(() => processTurn(bot), 1000);
    }, 1000);
}

function nextTurn() {
    let p = players[turnIndex];
    if (p.buffs.immuneTurns > 0) p.buffs.immuneTurns--;
    if (p.debuffs.cardLocked > 0) p.debuffs.cardLocked--;
    turnIndex = (turnIndex + 1) % players.length;
    isAnimating = false; updateUI();
    if (players[turnIndex].isBot) botLogic(players[turnIndex]);
}

function updateUI() {
    let currentP = players[turnIndex];
    
    let ava = document.getElementById('current-turn-avatar');
    if (ava) ava.innerText = currentP.avatar;
    
    let txt = document.getElementById('current-turn-text');
    if (txt) { txt.innerText = currentP.name; txt.style.color = currentP.color; }

    players.forEach(p => {
        let posEl = document.getElementById(`pos-p${p.id}`);
        if(posEl) posEl.innerText = p.pos;
        
        let statEl = document.getElementById(`stat-p${p.id}`);
        if(statEl) statEl.classList.remove('active');
        
        let statHTML = "";
        if (p.buffs.shield > 0) statHTML += "🛡️"; if (p.buffs.immuneTurns > 0) statHTML += "🔮"; if (p.debuffs.frozen > 0) statHTML += "❄️"; if (p.debuffs.brokenDice > 0) statHTML += "💥"; if (p.debuffs.cardLocked > 0) statHTML += "🕸️";
        let statusIconEl = document.getElementById(`status-p${p.id}`);
        if(statusIconEl) statusIconEl.innerHTML = statHTML;
    });

    let currStatEl = document.getElementById(`stat-p${currentP.id}`);
    if (currStatEl) currStatEl.classList.add('active');
    
    let countEl = document.getElementById('card-count');
    if (countEl) countEl.innerText = currentP.inventory.length;
    
    let list = document.getElementById('cards-list');
    if (list) {
        if (currentP.inventory.length === 0) list.innerHTML = `<div class="empty-cards">Belum ada kartu. Injak peti misteri!</div>`;
        else {
            list.innerHTML = '';
            currentP.inventory.forEach((c, idx) => {
                let onClickEvent = currentP.isBot ? "" : `onclick="usePlayerCard(${idx})"`;
                list.innerHTML += `<div class="mistery-card ${c.type}" ${onClickEvent}><span>${c.name}</span><div class="icon">${c.icon}</div><span>${c.desc}</span></div>`;
            });
        }
    }
}

function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.innerText = msg;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => { t.remove(); }, 3500);
}

window.onload = () => { try { init(); } catch(e) { console.error("Gagal init:", e); } };