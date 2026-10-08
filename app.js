import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, onSnapshot, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBOZIHmxS_CXwTAzt6dqnDf975BPyiD_uw",
    authDomain: "worsync.firebaseapp.com",
    projectId: "worsync",
    storageBucket: "worsync.firebasestorage.app",
    messagingSenderId: "895924376915",
    appId: "1:895924376915:web:4b5976dd8babc37b3dbda6",
    measurementId: "G-45FS4H1890"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentRoomId = "";
let isHost = false;
let hostForceFollow = true;
let isDrummerMode = false;
let cloudSongsLibrary = []; 
let personalSetlist = [];   
let currentSong = null;
let currentTransposeOffset = 0;
let personalCapoOffset = 0;
let currentSongBpm = 120;

let metronomeTimer = null;
let isAutoScrolling = false;
let autoScrollInterval = null;
let participantId = 'user_' + Math.random().toString(36).substring(2, 9);
let heartbeatTimer = null;

const notesSharp = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const notesFlat  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const chordRegex = /([A-G][b\#]?[m]?2?3?4?5?6?7?9?11?13?(?:\/[A-G][b\#]?)?)/g;

window.addEventListener('DOMContentLoaded', () => {
    loadPersonalSetlist();
    initGlobalCloudLibrary();
    registerServiceWorker();
});

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

function loadPersonalSetlist() {
    const savedSetlist = localStorage.getItem('worsync_personal_setlist');
    if(savedSetlist) {
        try { personalSetlist = JSON.parse(savedSetlist); } catch(e) { personalSetlist = []; }
    } else {
        personalSetlist = [];
        localStorage.setItem('worsync_personal_setlist', JSON.stringify(personalSetlist));
    }

    if(personalSetlist.length > 0) {
        currentSong = personalSetlist[0];
        currentTransposeOffset = 0;
        currentSongBpm = currentSong.bpm || 120;
        renderSongContent();
    }
    renderSetlistUI();
    updateArtistSuggestions();
}

function savePersonalSetlist() {
    localStorage.setItem('worsync_personal_setlist', JSON.stringify(personalSetlist));
    renderSetlistUI();
    updateArtistSuggestions();
}

function updateArtistSuggestions() {
    const datalist = document.getElementById('artistSuggestions');
    if(!datalist) return;
    datalist.innerHTML = '';
    const artists = [...new Set(cloudSongsLibrary.map(s => s.artist))];
    artists.forEach(artist => {
        const opt = document.createElement('option');
        opt.value = artist;
        datalist.appendChild(opt);
    });
}

async function initGlobalCloudLibrary() {
    const cachedCloud = localStorage.getItem('worsync_cloud_cache');
    if(cachedCloud) {
        try { cloudSongsLibrary = JSON.parse(cachedCloud); } catch(e) {}
    }

    try {
        const querySnapshot = await getDocs(collection(db, "songsLibrary"));
        cloudSongsLibrary = [];
        querySnapshot.forEach((doc) => { cloudSongsLibrary.push(doc.data()); });
        localStorage.setItem('worsync_cloud_cache', JSON.stringify(cloudSongsLibrary));
    } catch(err) {}

    onSnapshot(collection(db, "songsLibrary"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const updatedSong = change.doc.data();
            const index = cloudSongsLibrary.findIndex(s => s.id === updatedSong.id);
            if(index === -1) {
                cloudSongsLibrary.push(updatedSong);
            } else {
                cloudSongsLibrary[index] = updatedSong;
            }
            localStorage.setItem('worsync_cloud_cache', JSON.stringify(cloudSongsLibrary));
            updateArtistSuggestions();
        });
    });
}

window.manualSyncCloud = async () => {
    try {
        const querySnapshot = await getDocs(collection(db, "songsLibrary"));
        let count = 0;
        querySnapshot.forEach((document) => {
            const cloudSong = document.data();
            if(!cloudSongsLibrary.find(s => s.id === cloudSong.id)) {
                cloudSongsLibrary.push(cloudSong);
                count++;
            }
        });
        localStorage.setItem('worsync_cloud_cache', JSON.stringify(cloudSongsLibrary));
        renderCloudBrowserList(cloudSongsLibrary);
        alert(`Successfully synced! Found ${count} new song(s) from Cloud.`);
    } catch(e) {
        alert("Sync failed. Please check your network connection.");
    }
}

window.openCloudBrowser = () => {
    if(!isHost && currentRoomId) {
        alert("Only the Host can add songs to the setlist for this room!");
        return;
    }
    document.getElementById('cloudBrowserModal').classList.remove('hidden');
    renderCloudBrowserList(cloudSongsLibrary);
}

window.closeCloudBrowser = () => document.getElementById('cloudBrowserModal').classList.add('hidden');

window.filterCloudSongs = () => {
    const query = document.getElementById('cloudSearchInput').value.toLowerCase();
    const filtered = cloudSongsLibrary.filter(song => 
        song.title.toLowerCase().includes(query) || song.artist.toLowerCase().includes(query)
    );
    renderCloudBrowserList(filtered);
}

function renderCloudBrowserList(list) {
    const container = document.getElementById('cloudSongList');
    container.innerHTML = '';
    if(list.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">No songs found in cloud library.</p>`;
        return;
    }

    list.forEach(song => {
        const isInSetlist = personalSetlist.some(s => s.id === song.id);
        const item = document.createElement('div');
        item.className = "bg-slate-900 border border-slate-700 p-2.5 rounded flex justify-between items-center text-xs";
        item.innerHTML = `<div><p class="font-bold text-white">${song.title}</p><p class="text-slate-400 text-[10px]">${song.artist} • Key: <span class="text-amber-400">${song.key || 'C'}</span> • BPM: <span class="text-emerald-400">${song.bpm || 120}</span></p></div>`;

        const btn = document.createElement('button');
        if(isInSetlist) {
            btn.className = "bg-slate-700 text-slate-400 px-2.5 py-1 rounded text-[10px] cursor-not-allowed";
            btn.innerText = "Added";
            btn.disabled = true;
        } else {
            btn.className = "bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold px-2.5 py-1 rounded text-[10px] transition";
            btn.innerText = "+ Add";
            btn.onclick = () => addSongToPersonalSetlist(song);
        }
        item.appendChild(btn);
        container.appendChild(item);
    });
}

async function addSongToPersonalSetlist(song) {
    if(!personalSetlist.some(s => s.id === song.id)) {
        personalSetlist.push(song);
        savePersonalSetlist();
        renderCloudBrowserList(cloudSongsLibrary);
        selectSong(song.id);

        if(isHost && currentRoomId) {
            await updateDoc(doc(db, "jamRooms", currentRoomId), {
                setlist: personalSetlist.map(s => s.id),
                updatedAt: new Date()
            });
        }
    }
}

window.removeSongFromSetlist = async (event, songId) => {
    event.stopPropagation();
    if(!isHost && currentRoomId) {
        alert("Only the Host can delete songs from the setlist!");
        return;
    }

    if(confirm("Are you sure you want to remove this song from your setlist?")) {
        personalSetlist = personalSetlist.filter(s => s.id !== songId);
        savePersonalSetlist();

        if(currentSong && currentSong.id === songId) {
            if(personalSetlist.length > 0) selectSong(personalSetlist[0].id);
            else { currentSong = null; location.reload(); }
        }

        if(isHost && currentRoomId) {
            await updateDoc(doc(db, "jamRooms", currentRoomId), {
                setlist: personalSetlist.map(s => s.id),
                updatedAt: new Date()
            });
        }
    }
}

window.adjustCapo = (direction) => {
    personalCapoOffset = (personalCapoOffset + direction + 12) % 12;
    document.getElementById('capoDisplay').innerText = personalCapoOffset;
    renderSongContent();
}

window.toggleStageMode = () => {
    const body = document.getElementById('appBody');
    const btn = document.getElementById('stageModeBtn');
    body.classList.toggle('stage-mode');
    btn.className = body.classList.contains('stage-mode') 
        ? "bg-amber-500 text-slate-950 font-bold text-xs px-2.5 py-1.5 rounded transition" 
        : "bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs px-2.5 py-1.5 rounded font-medium transition";
    btn.innerText = body.classList.contains('stage-mode') ? "⚡ Stage Active" : "💡 Stage Mode";
}

window.toggleDrummerMode = () => {
    isDrummerMode = !isDrummerMode;
    const body = document.getElementById('appBody');
    const btn = document.getElementById('drummerModeBtn');
    
    body.classList.toggle('drummer-mode', isDrummerMode);
    if(isDrummerMode) {
        btn.className = "bg-emerald-600 text-white font-bold text-xs px-2.5 py-1.5 rounded transition";
        btn.innerText = "🥁 Drummer Active";
    } else {
        btn.className = "bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs px-2.5 py-1.5 rounded font-medium transition";
        btn.innerText = "🥁 Drummer Mode";
    }
}

// Auto-Scroll Toggle Function
window.toggleAutoScroll = () => {
    isAutoScrolling = !isAutoScrolling;
    const btn = document.getElementById('autoScrollBtn');
    const container = document.getElementById('lyricsContainer');

    if(isAutoScrolling) {
        btn.className = "bg-rose-600 hover:bg-rose-500 text-white font-bold px-2 py-0.5 rounded text-[10px]";
        btn.innerText = "Stop";
        let scrollSpeed = Math.max(30, Math.floor(12000 / currentSongBpm)); 
        autoScrollInterval = setInterval(() => {
            container.scrollBy({ top: 1, behavior: 'smooth' });
        }, scrollSpeed);
    } else {
        btn.className = "bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold px-2 py-0.5 rounded text-[10px]";
        btn.innerText = "Start";
        clearInterval(autoScrollInterval);
    }
}

window.showRoomQR = () => {
    if(!currentRoomId) return;
    document.getElementById('qrRoomCodeText').innerText = `Room Code: ${currentRoomId}`;
    document.getElementById('qrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(currentRoomId)}&bgcolor=1e293b&color=f59e0b`;
    document.getElementById('qrModal').classList.remove('hidden');
}

window.changeRoomTranspose = async (direction) => {
    if(!isHost) {
        alert("Only the Host can transpose keys for the room!");
        return;
    }
    if(!currentSong) return;

    let newOffset = (currentTransposeOffset + direction + 12) % 12;
    if(currentRoomId) {
        await updateDoc(doc(db, "jamRooms", currentRoomId), {
            transposeOffset: newOffset,
            updatedAt: new Date()
        });
    } else {
        currentTransposeOffset = newOffset;
        renderSongContent();
    }
}

window.updateRoomBpm = async (newBpm) => {
    if(!isHost || !currentRoomId) return;
    let parsedBpm = parseInt(newBpm) || 120;
    currentSongBpm = parsedBpm;
    
    startVisualMetronome(parsedBpm);
    await updateDoc(doc(db, "jamRooms", currentRoomId), {
        songBpm: parsedBpm,
        updatedAt: new Date()
    });
}

function startVisualMetronome(bpm) {
    if(metronomeTimer) clearInterval(metronomeTimer);
    const intervalMs = (60 / bpm) * 1000;
    const flasher = document.getElementById('visualMetronomeFlasher');
    const dot = document.getElementById('metronomePulseDot');
    
    if(flasher) flasher.classList.remove('hidden');

    metronomeTimer = setInterval(() => {
        if(!dot) return;
        dot.classList.remove('beat-pulse');
        void dot.offsetWidth;
        dot.classList.add('beat-pulse');
    }, intervalMs);
}

function transposeRawText(text, semitones) {
    let totalOffset = (semitones + personalCapoOffset) % 12;
    if(totalOffset === 0) return text;
    return text.split('\n').map(line => {
        if(line.startsWith('>')) {
            return '>' + line.substring(1).replace(chordRegex, m => transposeSingleChord(m, totalOffset));
        } else {
            return line.replace(/<([^>]+)>/g, (_, chords) => `<${chords.replace(chordRegex, m => transposeSingleChord(m, totalOffset))}>`);
        }
    }).join('\n');
}

function transposeSingleChord(chord, semitones) {
    let rootMatch = chord.match(/^([A-G][b\#]?)(.*)/);
    if(!rootMatch) return chord;
    let noteList = rootMatch[1].includes("b") ? notesFlat : notesSharp;
    let idx = noteList.indexOf(rootMatch[1]);
    if(idx === -1) return chord;
    return noteList[(idx + semitones + 12) % 12] + rootMatch[2];
}

window.createRoomAsHost = async () => {
    const code = document.getElementById('hostCodeInput').value.trim().toUpperCase();
    if(!code) return alert("Please enter a Room Code first!");
    
    currentRoomId = code;
    isHost = true;
    
    const roomRef = doc(db, "jamRooms", currentRoomId);
    await setDoc(roomRef, {
        currentSongId: currentSong ? currentSong.id : "",
        activeSection: getFirstSectionKey(currentSong),
        hostForceFollow: true,
        transposeOffset: 0,
        songBpm: currentSongBpm,
        setlist: personalSetlist.map(s => s.id),
        updatedAt: new Date()
    }, { merge: true });

    setupUI();
    startListening();
    initParticipantPresence();
};

window.joinRoomAsParticipant = async () => {
    const code = document.getElementById('participantCodeInput').value.trim().toUpperCase();
    if(!code) return alert("Please enter the Room Code!");

    currentRoomId = code;
    isHost = false;

    try {
        const snap = await getDoc(doc(db, "jamRooms", currentRoomId));
        if(!snap.exists()) {
            alert("Room Code not found or session has already ended.");
            currentRoomId = "";
            return;
        }

        setupUI();
        startListening();
        initParticipantPresence();
    } catch(err) {
        alert("Unable to connect to the room.");
    }
};

function initParticipantPresence() {
    if(!currentRoomId) return;
    const pRef = doc(db, "jamRooms", currentRoomId, "participants", participantId);
    
    const sendPing = () => {
        setDoc(pRef, { lastSeen: Date.now(), isHost: isHost }, { merge: true }).catch(() => {});
    };

    sendPing();
    heartbeatTimer = setInterval(sendPing, 4000);

    const cleanup = () => {
        clearInterval(heartbeatTimer);
        deleteDoc(pRef).catch(() => {});
    };

    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);

    onSnapshot(collection(db, "jamRooms", currentRoomId, "participants"), (snapshot) => {
        const now = Date.now();
        let activeCount = 0;
        snapshot.forEach((d) => {
            const data = d.data();
            if(data.lastSeen && (now - data.lastSeen < 8000)) activeCount++;
            else deleteDoc(d.ref).catch(() => {});
        });
        const badge = document.getElementById('roomParticipantCount');
        if(badge) badge.innerText = `👥 ${Math.max(1, activeCount)}`;
    });
}

window.leaveRoomAndRefresh = async () => {
    if(currentRoomId) {
        try {
            clearInterval(heartbeatTimer);
            if(isHost) await deleteDoc(doc(db, "jamRooms", currentRoomId));
            else await deleteDoc(doc(db, "jamRooms", currentRoomId, "participants", participantId));
        } catch(e) {}
    }
    location.reload();
}

function setupUI() {
    document.getElementById('roomSetupScreen').classList.add('hidden');
    document.getElementById('activeRoomDisplay').innerText = `Room: ${currentRoomId}`;
    document.getElementById('metronomeContainer').classList.remove('hidden');
    document.getElementById('drummerModeBtn').classList.remove('hidden');
    
    document.getElementById('roleBadge').innerText = isHost ? "Mode: HOST" : "Mode: Participant";
    document.getElementById('roleBadge').className = isHost ? "text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-1 rounded font-semibold" : "text-xs bg-slate-700 px-2 py-1 rounded text-slate-300";
    
    document.getElementById('followModeSyncBtn').classList.toggle('hidden', !isHost);
    document.getElementById('floatingHostController').classList.toggle('hidden', !isHost);
    document.getElementById('participantStatusBadge').style.display = isHost ? 'none' : 'flex';

    const bpmInput = document.getElementById('currentBpmInput');
    if(bpmInput) bpmInput.disabled = !isHost;
}

function startListening() {
    onSnapshot(doc(db, "jamRooms", currentRoomId), (docSnap) => {
        if(docSnap.exists()) {
            const data = docSnap.data();
            if(data.hostForceFollow !== undefined) {
                hostForceFollow = data.hostForceFollow;
                updateSharedSyncUI();
            }
            if(data.setlist && Array.isArray(data.setlist)) {
                personalSetlist = data.setlist.map(id => cloudSongsLibrary.find(s => s.id === id) || personalSetlist.find(s => s.id === id)).filter(Boolean);
                savePersonalSetlist();
            }
            if(data.transposeOffset !== undefined) {
                currentTransposeOffset = data.transposeOffset;
            }
            if(data.songBpm !== undefined && data.songBpm !== currentSongBpm) {
                currentSongBpm = data.songBpm;
                document.getElementById('currentBpmInput').value = currentSongBpm;
                startVisualMetronome(currentSongBpm);
            }
            if(data.currentSongId && (!currentSong || currentSong.id !== data.currentSongId)) {
                let found = personalSetlist.find(s => s.id === data.currentSongId) || cloudSongsLibrary.find(s => s.id === data.currentSongId);
                if(found) { 
                    currentSong = found; 
                    currentTransposeOffset = data.transposeOffset || 0; 
                    currentSongBpm = found.bpm || 120;
                    document.getElementById('currentBpmInput').value = currentSongBpm;
                    startVisualMetronome(currentSongBpm);
                    renderSetlistUI(); 
                    renderSongContent(); 
                }
            } else {
                if(currentSong) renderSongContent();
            }
            if(data.activeSection) highlightSection(data.activeSection);
        } else {
            if(!isHost) {
                alert("The Host has ended the session.");
                location.reload();
            }
        }
    });
}

window.selectSong = async (songId) => {
    const found = personalSetlist.find(s => s.id === songId);
    if(found) {
        currentSong = found;
        currentTransposeOffset = 0;
        currentSongBpm = found.bpm || 120;
        document.getElementById('currentBpmInput').value = currentSongBpm;
        startVisualMetronome(currentSongBpm);
        renderSetlistUI();
        renderSongContent();

        if(isHost && currentRoomId) {
            await updateDoc(doc(db, "jamRooms", currentRoomId), {
                currentSongId: songId,
                activeSection: getFirstSectionKey(currentSong),
                transposeOffset: 0,
                songBpm: currentSongBpm,
                updatedAt: new Date()
            });
        }
    }
}

function getFirstSectionKey(song) {
    if(!song || !song.text) return 'Intro';
    const match = song.text.split('\n').find(l => l.trim().startsWith('[') && l.trim().endsWith(']'));
    return match ? match.trim().substring(1, match.trim().length - 1) : 'Intro';
}

window.updateHostState = async (sectionKey) => {
    if(!isHost) return;
    await updateDoc(doc(db, "jamRooms", currentRoomId), { activeSection: sectionKey, updatedAt: new Date() });
};

window.handleSectionClick = (sectionKey) => {
    if(isHost) updateHostState(sectionKey);
    else if(!hostForceFollow) highlightSection(sectionKey);
}

window.toggleHostLock = async () => {
    if(!isHost) return;
    hostForceFollow = !hostForceFollow;
    await updateDoc(doc(db, "jamRooms", currentRoomId), { hostForceFollow: hostForceFollow, updatedAt: new Date() });
}

function updateSharedSyncUI() {
    const lyricsCard = document.getElementById('lyricsCardSection');
    lyricsCard.classList.toggle('host-sync-glow', hostForceFollow);
    if(!isHost) {
        document.getElementById('statusText').innerText = hostForceFollow ? "Follow Mode: ON (Locked)" : "Follow Mode: OFF (Free Scroll)";
        document.getElementById('statusDot').className = hostForceFollow ? "w-2 h-2 rounded-full bg-emerald-400 animate-pulse" : "w-2 h-2 rounded-full bg-slate-400";
    } else {
        document.getElementById('headerSyncText').innerText = hostForceFollow ? "Follow Mode: ON" : "Follow Mode: OFF";
    }
}

function highlightSection(sectionKey) {
    document.querySelectorAll('#lyricsContainer > div').forEach(el => el.classList.remove('bg-amber-500/10', 'border-amber-500/50', 'shadow-md'));
    const activeEl = document.getElementById(`section-${CSS.escape(sectionKey)}`);
    if(activeEl) {
        activeEl.classList.add('bg-amber-500/10', 'border-amber-500/50', 'shadow-md');
        if(isHost || hostForceFollow) activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function renderSetlistUI() {
    const listEl = document.getElementById('songList');
    listEl.innerHTML = '';
    if(personalSetlist.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">Setlist is empty.</p>`;
        return;
    }

    const grouped = {};
    personalSetlist.forEach(song => {
        const artist = song.artist || 'Unknown';
        if(!grouped[artist]) grouped[artist] = [];
        grouped[artist].push(song);
    });

    for(const [artist, songs] of Object.entries(grouped)) {
        const artistGroup = document.createElement('div');
        artistGroup.className = "space-y-1";
        artistGroup.innerHTML = `<p class="text-[11px] font-bold text-amber-400/80 uppercase tracking-wider px-1 pt-1">${artist}</p>`;

        songs.forEach(song => {
            const isSelected = currentSong && currentSong.id === song.id;
            const btn = document.createElement('button');
            btn.className = `w-full text-left px-3 py-1.5 rounded text-xs transition flex justify-between items-center ${isSelected ? 'bg-amber-500/20 text-amber-400 font-semibold border-l-4 border-amber-500' : 'hover:bg-slate-700/50 text-slate-300'}`;
            btn.innerHTML = `<span>${song.title}</span><div class="flex items-center gap-1.5"><span class="text-[9px] font-mono bg-slate-800 px-1 py-0.5 rounded text-emerald-400 border border-slate-700">${song.bpm || 120}bpm</span><span class="text-[9px] font-mono bg-slate-800 px-1 py-0.5 rounded text-amber-400/80 border border-slate-700">${song.key || 'C'}</span>${isHost ? `<span class="text-rose-400 hover:text-rose-300 font-bold px-1 text-[11px]" title="Remove">✕</span>` : ''}</div>`;
            
            if(isHost) {
                btn.querySelector('.text-rose-400').onclick = (e) => removeSongFromSetlist(e, song.id);
            }
            btn.onclick = () => selectSong(song.id);
            artistGroup.appendChild(btn);
        });
        listEl.appendChild(artistGroup);
    }
}

function renderSongContent() {
    if(!currentSong) return;
    document.getElementById('songTitle').innerText = currentSong.title;
    document.getElementById('songArtist').innerText = currentSong.artist;
    document.getElementById('originalSongKeyDisplay').innerText = currentSong.key || 'C';
    
    let baseKey = currentSong.key || "C";
    let noteList = baseKey.includes("b") ? notesFlat : notesSharp;
    let idx = noteList.indexOf(baseKey);
    if(idx === -1) idx = 0;
    document.getElementById('currentKey').innerText = noteList[(idx + currentTransposeOffset) % 12];

    const container = document.getElementById('lyricsContainer');
    container.innerHTML = '';
    const hostButtonsContainer = document.getElementById('hostSectionButtons');
    hostButtonsContainer.innerHTML = '';

    let transposedRaw = transposeRawText(currentSong.text || "", currentTransposeOffset);
    let lines = transposedRaw.split('\n');
    let currentSectionName = "Intro";
    let sectionLines = [];
    let sectionsMap = {};

    const flushSection = () => {
        if(sectionLines.length > 0) {
            sectionsMap[currentSectionName] = sectionLines.join('\n');
            sectionLines = [];
        }
    };

    lines.forEach(line => {
        let trimmed = line.trim();
        if(trimmed.startsWith('[') && trimmed.endsWith(']')) {
            flushSection();
            currentSectionName = trimmed.substring(1, trimmed.length - 1);
        } else {
            sectionLines.push(line);
        }
    });
    flushSection();

    for(const [secName, secText] of Object.entries(sectionsMap)) {
        const div = document.createElement('div');
        div.id = `section-${CSS.escape(secName)}`;
        div.className = 'section-card p-3 rounded border border-slate-700/40 hover:border-amber-500/40';
        div.onclick = () => handleSectionClick(secName);

        let formattedHTML = `<h3 class="text-xs uppercase font-sans tracking-wider text-amber-400/70 mb-1 font-bold pointer-events-none">${secName}</h3><pre class="chord-lyrics-pre text-sm pointer-events-none">`;
        
        secText.split('\n').forEach(sLine => {
            if(sLine.startsWith('>')) {
                formattedHTML += `<span class="chord-line">${sLine.substring(1).replace(chordRegex, m => `<span class="chord-line">${m}</span>`)}</span>\n`;
            } else {
                formattedHTML += `${sLine.replace(/<([^>]+)>/g, (_, chords) => `<span class="chord-line font-bold">${chords}</span>`)}\n`;
            }
        });
        formattedHTML += `</pre>`;
        div.innerHTML = formattedHTML;
        container.appendChild(div);

        const hBtn = document.createElement('button');
        hBtn.className = "bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded text-xs font-medium uppercase whitespace-nowrap transition shrink-0";
        hBtn.innerText = secName;
        hBtn.onclick = () => updateHostState(secName);
        hostButtonsContainer.appendChild(hBtn);
    }
}

window.openAddSongModal = () => document.getElementById('addSongModal').classList.remove('hidden');
window.closeAddSongModal = () => document.getElementById('addSongModal').classList.add('hidden');

window.saveNewSongToCloud = async () => {
    const artist = document.getElementById('newSongArtist').value.trim();
    const title = document.getElementById('newSongTitle').value.trim();
    const key = document.getElementById('newSongKey').value.trim().toUpperCase() || 'C';
    const bpm = parseInt(document.getElementById('newSongBpm').value) || 120;
    const text = document.getElementById('newSongText').value.trim();

    if(!artist || !title || !text) return alert("Please fill in Artist, Title, and Text!");

    const songId = title.toLowerCase().replace(/[^a-z0-9]/g, '_') + "_" + Math.floor(Math.random() * 1000);
    const newSongData = { id: songId, title, artist, key, bpm, text };

    cloudSongsLibrary.push(newSongData);
    personalSetlist.push(newSongData);
    savePersonalSetlist();
    selectSong(songId);

    if(isHost && currentRoomId) {
        await updateDoc(doc(db, "jamRooms", currentRoomId), {
            setlist: personalSetlist.map(s => s.id),
            updatedAt: new Date()
        });
    }

    try {
        await setDoc(doc(db, "songsLibrary", songId), newSongData);
        alert("Successfully saved to Cloud and added to your Setlist!");
    } catch(e) {
        alert("Saved to setlist (offline mode).");
    }

    closeAddSongModal();
    document.getElementById('newSongArtist').value = '';
    document.getElementById('newSongTitle').value = '';
    document.getElementById('newSongKey').value = '';
    document.getElementById('newSongBpm').value = '120';
    document.getElementById('newSongText').value = '';
}
