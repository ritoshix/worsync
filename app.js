import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
let songsLibrary = [];
let currentSong = null;
let currentTransposeOffset = 0;

const notesSharp = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const notesFlat  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const chordDiagrams = {
    "C": "    I  II III\ne |--|--|--|\nB |-o-|--|--|\nG |--|--|--|\nD |--|-o-|--|\nA |--|--|-o-|",
    "G": "    I  II III\ne |-o-|--|--|\nB |--|--|--|\nG |--|--|--|\nD |--|--|--|\nA |--|-o-|--|\nE |--|--|-o-|",
    "Am": "    I  II III\ne |--|--|--|\nB |--|-o-|--|\nG |--|-o-|--|\nD |--|--|-o-|",
    "F": "    I  II III\ne [o][o][o]\nB |--|-o-|--|\nG |--|--|-o-|",
    "Dm": "    I  II III\ne |--|--|-o-|\nB |--|--|--|\nG |--|-o-|--|\nD |--|--|--|",
    "E": "    I  II III\ne |--|--|--|\nB |--|--|--|\nG |--|-o-|--|\nD |--|-o-|--|\nA |--|-o-|--|",
    "Em": "    I  II III\ne |--|--|--|\nB |--|--|--|\nG |--|--|--|\nD |--|-o-|--|\nA |--|-o-|--|"
};

const defaultSongs = [
    {
        id: "torete",
        title: "Torete",
        artist: "Moonstar88",
        key: "C",
        text: "[Verse 1]\n>    C          G\nTe narito ka na naman\n>    Am             F\nPinapawi ang luha sa aking mga mata\n\n[Chorus]\n>    C        G\nIsang tingin mo lang\n>    Am         F\nAking nasisigawan ang buong mundo"
    }
];

window.addEventListener('DOMContentLoaded', () => {
    loadSongsFromLocalStorage();
    initGlobalCloudLibrary();
});

function loadSongsFromLocalStorage() {
    const localData = localStorage.getItem('worsync_songs');
    if(localData) {
        try {
            songsLibrary = JSON.parse(localData);
            if(songsLibrary.length > 0) {
                currentSong = songsLibrary[0];
                currentTransposeOffset = 0;
                renderSongList(songsLibrary);
                renderSongContent();
            }
        } catch(e) { console.error(e); }
    } else {
        songsLibrary = defaultSongs;
        localStorage.setItem('worsync_songs', JSON.stringify(songsLibrary));
        currentSong = songsLibrary[0];
        currentTransposeOffset = 0;
        renderSongList(songsLibrary);
        renderSongContent();
    }
    updateArtistSuggestions();
}

function saveSongsToLocalStorage() {
    localStorage.setItem('worsync_songs', JSON.stringify(songsLibrary));
    updateArtistSuggestions();
}

function updateArtistSuggestions() {
    const datalist = document.getElementById('artistSuggestions');
    if(!datalist) return;
    datalist.innerHTML = '';
    
    const artists = [...new Set(songsLibrary.map(s => s.artist))];
    artists.forEach(artist => {
        const opt = document.createElement('option');
        opt.value = artist;
        datalist.appendChild(opt);
    });
}

async function initGlobalCloudLibrary() {
    try {
        const querySnapshot = await getDocs(collection(db, "songsLibrary"));
        let cloudSongs = [];
        querySnapshot.forEach((doc) => {
            cloudSongs.push(doc.data());
        });

        if(cloudSongs.length > 0) {
            songsLibrary = cloudSongs;
            saveSongsToLocalStorage();
        } else {
            for(let song of defaultSongs) {
                await setDoc(doc(db, "songsLibrary", song.id), song);
            }
        }

        if(!currentSong && songsLibrary.length > 0) {
            currentSong = songsLibrary[0];
            currentTransposeOffset = 0;
        }
        renderSongList(songsLibrary);
        renderSongContent();
    } catch(err) {
        console.log("Offline mode: Using LocalStorage cache.");
    }

    onSnapshot(collection(db, "songsLibrary"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const updatedSong = change.doc.data();
            const index = songsLibrary.findIndex(s => s.id === updatedSong.id);
            if(index === -1) {
                songsLibrary.push(updatedSong);
            } else {
                songsLibrary[index] = updatedSong;
            }
            saveSongsToLocalStorage();
            filterSongs();

            if(currentSong && currentSong.id === updatedSong.id) {
                currentSong = updatedSong;
                renderSongContent();
            }
        });
    });
}

window.manualSyncCloud = async () => {
    try {
        const querySnapshot = await getDocs(collection(db, "songsLibrary"));
        let cloudCount = 0;
        
        querySnapshot.forEach(async (document) => {
            const cloudSong = document.data();
            const exists = songsLibrary.find(s => s.id === cloudSong.id);
            if(!exists) {
                songsLibrary.push(cloudSong);
                cloudCount++;
            }
        });

        for(let localSong of songsLibrary) {
            await setDoc(doc(db, "songsLibrary", localSong.id), localSong);
        }

        saveSongsToLocalStorage();
        renderSongList(songsLibrary);
        alert(`Successfully synced! Added ${cloudCount} new song(s) from the Cloud.`);
    } catch(e) {
        alert("Sync failed. Please check your internet connection.");
    }
}

window.transposeKey = (direction) => {
    if(!currentSong) return;
    currentTransposeOffset = (currentTransposeOffset + direction + 12) % 12;
    
    let baseKey = currentSong.key || "C";
    let noteList = baseKey.includes("b") ? notesFlat : notesSharp;
    let idx = noteList.indexOf(baseKey);
    if(idx === -1) idx = notesSharp.indexOf(baseKey);
    if(idx === -1) idx = 0;
    
    let newKeyIdx = (idx + currentTransposeOffset) % 12;
    document.getElementById('currentKey').innerText = noteList[newKeyIdx];
    renderSongContent();
}

function transposeRawText(text, semitones) {
    if(semitones === 0) return text;
    let lines = text.split('\n');
    let processedLines = lines.map(line => {
        if(line.startsWith('>')) {
            return '>' + line.substring(1).replace(/([A-G][b\#]?[m]?2?3?4?5?6?7?9?11?13?(?:\/[A-G][b\#]?)?)/g, match => transposeSingleChord(match, semitones));
        } else {
            return line.replace(/<([^>]+)>/g, (m, chords) => {
                let transposedChords = chords.replace(/([A-G][b\#]?[m]?2?3?4?5?6?7?9?11?13?(?:\/[A-G][b\#]?)?)/g, match => transposeSingleChord(match, semitones));
                return `<${transposedChords}>`;
            });
        }
    });
    return processedLines.join('\n');
}

function transposeSingleChord(chord, semitones) {
    let rootMatch = chord.match(/^([A-G][b\#]?)(.*)/);
    if(!rootMatch) return chord;
    let root = rootMatch[1];
    let suffix = rootMatch[2];
    
    let noteList = root.includes("b") ? notesFlat : notesSharp;
    let idx = noteList.indexOf(root);
    if(idx === -1) idx = notesSharp.indexOf(root);
    if(idx === -1) return chord;
    
    let newIdx = (idx + semitones + 12) % 12;
    return noteList[newIdx] + suffix;
}

window.createRoomAsHost = async () => {
    const code = document.getElementById('hostCodeInput').value.trim().toUpperCase();
    if(!code) return alert("Please enter a Room Code first!");
    
    currentRoomId = code;
    isHost = true;
    
    const roomRef = doc(db, "jamRooms", currentRoomId);
    await setDoc(roomRef, {
        currentSongId: currentSong ? currentSong.id : "torete",
        activeSection: getFirstSectionKey(currentSong),
        hostForceFollow: true,
        updatedAt: new Date()
    }, { merge: true });

    setupUI();
    startListening();
};

window.joinRoomAsParticipant = async () => {
    const code = document.getElementById('participantCodeInput').value.trim().toUpperCase();
    if(!code) return alert("Please enter the Room Code provided by the Host!");

    currentRoomId = code;
    isHost = false;

    const roomRef = doc(db, "jamRooms", currentRoomId);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) {
        alert("No active room found with this code!");
        return;
    }

    setupUI();
    startListening();
};

function setupUI() {
    document.getElementById('roomSetupScreen').classList.add('hidden');
    document.getElementById('activeRoomDisplay').innerText = `Room: ${currentRoomId}`;
    
    const badge = document.getElementById('roleBadge');
    const hostControls = document.getElementById('hostControls');

    if(isHost) {
        badge.innerText = "Mode: HOST";
        badge.className = "text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-1 rounded font-semibold";
        hostControls.classList.remove('hidden');
        document.getElementById('participantStatusBadge').style.display = 'none';
    } else {
        badge.innerText = "Mode: Participant";
        badge.className = "text-xs bg-slate-700 px-2 py-1 rounded text-slate-300";
        hostControls.classList.add('hidden');
        document.getElementById('participantStatusBadge').style.display = 'flex';
    }
}

function startListening() {
    const roomRef = doc(db, "jamRooms", currentRoomId);
    onSnapshot(roomRef, (docSnap) => {
        if(docSnap.exists()) {
            const data = docSnap.data();
            
            if(data.hostForceFollow !== undefined) {
                hostForceFollow = data.hostForceFollow;
                updateSharedSyncUI();
            }

            if(data.currentSongId && (!currentSong || currentSong.id !== data.currentSongId)) {
                const found = songsLibrary.find(s => s.id === data.currentSongId);
                if(found) {
                    currentSong = found;
                    currentTransposeOffset = 0;
                    renderSongList(songsLibrary);
                    renderSongContent();
                }
            }

            if(data.activeSection) {
                highlightSection(data.activeSection);
            }
        }
    });
}

window.filterSongs = () => {
    const query = document.getElementById('searchSongInput').value.toLowerCase();
    const filtered = songsLibrary.filter(song => 
        song.title.toLowerCase().includes(query) || 
        song.artist.toLowerCase().includes(query)
    );
    renderSongList(filtered);
}

window.selectSong = async (songId) => {
    const found = songsLibrary.find(s => s.id === songId);
    if(found) {
        currentSong = found;
        currentTransposeOffset = 0;
        renderSongList(songsLibrary);
        renderSongContent();

        if(isHost && currentRoomId) {
            const roomRef = doc(db, "jamRooms", currentRoomId);
            await updateDoc(roomRef, {
                currentSongId: songId,
                activeSection: getFirstSectionKey(currentSong),
                updatedAt: new Date()
            });
        }
    }
}

function getFirstSectionKey(song) {
    if(!song || !song.text) return 'Intro';
    let lines = song.text.split('\n');
    for(let line of lines) {
        let trimmed = line.trim();
        if(trimmed.startsWith('[') && trimmed.endsWith(']')) {
            return trimmed.substring(1, trimmed.length - 1);
        }
    }
    return 'Intro';
}

window.updateHostState = async (sectionKey) => {
    if(!isHost) return;
    const roomRef = doc(db, "jamRooms", currentRoomId);
    await updateDoc(roomRef, {
        activeSection: sectionKey,
        updatedAt: new Date()
    });
};

window.handleSectionClick = (sectionKey) => {
    if (isHost) {
        updateHostState(sectionKey);
    } else if (!hostForceFollow) {
        highlightSection(sectionKey);
    }
}

window.toggleHostLock = async () => {
    if(!isHost) return;
    hostForceFollow = !hostForceFollow;
    const roomRef = doc(db, "jamRooms", currentRoomId);
    await updateDoc(roomRef, {
        hostForceFollow: hostForceFollow,
        updatedAt: new Date()
    });
}

function updateSharedSyncUI() {
    const lyricsCard = document.getElementById('lyricsCardSection');
    const statusText = document.getElementById('statusText');
    const statusDot = document.getElementById('statusDot');
    const statusBadge = document.getElementById('participantStatusBadge');
    const hostBtn = document.getElementById('hostLockToggleBtn');

    if(hostForceFollow) {
        if(isHost) {
            hostBtn.className = "bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[10px] px-2.5 py-1 rounded transition";
            hostBtn.innerText = "Broadcast Sync Mode: ON";
        } else {
            lyricsCard.classList.add('host-sync-glow');
            statusText.innerText = "Host Sync: ON (Locked)";
            statusDot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
            statusBadge.className = "text-xs bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 px-3 py-1.5 rounded font-semibold flex items-center gap-1.5";
        }
    } else {
        if(isHost) {
            hostBtn.className = "bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-[10px] px-2.5 py-1 rounded transition";
            hostBtn.innerText = "Broadcast Sync Mode: OFF (Free Scroll)";
        } else {
            lyricsCard.classList.remove('host-sync-glow');
            statusText.innerText = "Host Sync: OFF (Free Scroll)";
            statusDot.className = "w-2 h-2 rounded-full bg-slate-400";
            statusBadge.className = "text-xs bg-slate-700/60 text-slate-400 border border-slate-600 px-3 py-1.5 rounded font-semibold flex items-center gap-1.5";
        }
    }
}

function highlightSection(sectionKey) {
    document.querySelectorAll('#lyricsContainer > div').forEach(el => {
        el.classList.remove('bg-amber-500/10', 'border-amber-500/50', 'shadow-md');
    });

    const activeEl = document.getElementById(`section-${CSS.escape(sectionKey)}`);
    if(activeEl) {
        activeEl.classList.add('bg-amber-500/10', 'border-amber-500/50', 'shadow-md');
        if(isHost || hostForceFollow) {
            activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

function renderSongList(listToRender) {
    const listEl = document.getElementById('songList');
    listEl.innerHTML = '';
    
    if(listToRender.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">No songs found.</p>`;
        return;
    }

    const grouped = {};
    listToRender.forEach(song => {
        const artist = song.artist || 'Unknown Artist';
        if(!grouped[artist]) grouped[artist] = [];
        grouped[artist].push(song);
    });

    for(const [artist, songs] of Object.entries(grouped)) {
        const artistGroup = document.createElement('div');
        artistGroup.className = "space-y-1";

        const artistHeader = document.createElement('p');
        artistHeader.className = "text-[11px] font-bold text-amber-400/80 uppercase tracking-wider px-1 pt-1";
        artistHeader.innerText = artist;
        artistGroup.appendChild(artistHeader);

        songs.forEach(song => {
            const btn = document.createElement('button');
            const isSelected = currentSong && currentSong.id === song.id;
            btn.className = `w-full text-left px-3 py-1.5 rounded text-xs transition flex justify-between items-center ${isSelected ? 'bg-amber-500/20 text-amber-400 font-semibold border-l-4 border-amber-500' : 'hover:bg-slate-700/50 text-slate-300'}`;
            
            const spanTitle = document.createElement('span');
            spanTitle.innerText = song.title;
            
            const spanKey = document.createElement('span');
            spanKey.className = "text-[9px] font-mono bg-slate-800 px-1 py-0.5 rounded text-amber-400/80 border border-slate-700";
            spanKey.innerText = song.key || 'C';

            btn.appendChild(spanTitle);
            btn.appendChild(spanKey);
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
    if(idx === -1) idx = notesSharp.indexOf(baseKey);
    if(idx === -1) idx = 0;
    let displayedKey = noteList[(idx + currentTransposeOffset) % 12];
    document.getElementById('currentKey').innerText = displayedKey;

    const container = document.getElementById('lyricsContainer');
    container.innerHTML = '';

    const hostButtonsContainer = document.getElementById('hostSectionButtons');
    hostButtonsContainer.innerHTML = '';

    let rawText = currentSong.text || "";
    let transposedRaw = transposeRawText(rawText, currentTransposeOffset);
    let lines = transposedRaw.split('\n');

    let currentSectionName = "Intro";
    let sectionLines = [];
    let sectionsMap = {};

    function flushSection() {
        if(sectionLines.length > 0) {
            sectionsMap[currentSectionName] = sectionLines.join('\n');
            sectionLines = [];
        }
    }

    for(let line of lines) {
        let trimmed = line.trim();
        if(trimmed.startsWith('[') && trimmed.endsWith(']')) {
            flushSection();
            currentSectionName = trimmed.substring(1, trimmed.length - 1);
        } else {
            sectionLines.push(line);
        }
    }
    flushSection();

    for(const [secName, secText] of Object.entries(sectionsMap)) {
        const div = document.createElement('div');
        div.id = `section-${CSS.escape(secName)}`;
        div.className = 'section-card p-3 rounded border border-slate-700/40 hover:border-amber-500/40';
        div.setAttribute('onclick', `handleSectionClick('${secName}')`);

        let formattedHTML = `<h3 class="text-xs uppercase font-sans tracking-wider text-amber-400/70 mb-1 font-bold pointer-events-none">${secName}</h3><pre class="chord-lyrics-pre text-sm pointer-events-none">`;
        
        let subLines = secText.split('\n');
        for(let sLine of subLines) {
            if(sLine.startsWith('>')) {
                let chordContent = sLine.substring(1);
                formattedHTML += `<span class="chord-line">${formatClickableChordsInText(chordContent)}</span>\n`;
            } else {
                let parsedLine = sLine.replace(/<([^>]+)>/g, (m, chords) => {
                    return `<span class="chord-line font-bold">${formatClickableChordsInText(chords)}</span>`;
                });
                formattedHTML += `${parsedLine}\n`;
            }
        }
        formattedHTML += `</pre>`;
        div.innerHTML = formattedHTML;
        container.appendChild(div);

        const hBtn = document.createElement('button');
        hBtn.className = "bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-xs font-medium uppercase";
        hBtn.innerText = secName;
        hBtn.onclick = () => updateHostState(secName);
        hostButtonsContainer.appendChild(hBtn);
    }
}

function formatClickableChordsInText(text) {
    return text.replace(/([A-G][b\#]?[m]?2?3?4?5?6?7?9?11?13?(?:\/[A-G][b\#]?)?)/g, match => {
        return `<span class="clickable-chord" onclick="event.stopPropagation(); showChordModal('${match}')">${match}</span>`;
    });
}

window.showChordModal = (chordName) => {
    document.getElementById('modalChordTitle').innerText = chordName;
    let diag = chordDiagrams[chordName] || `    I  II III\ne |--|--|--|\nB |--|--|--|\nG |--|--|--|\nD |--|--|--|\nA |--|--|--|\nE |--|--|--|\n(Standard Position)`;
    document.getElementById('modalChordDiagram').innerText = diag;
    document.getElementById('chordModal').classList.remove('hidden');
}

window.closeChordModal = () => {
    document.getElementById('chordModal').classList.add('hidden');
}

window.openAddSongModal = () => document.getElementById('addSongModal').classList.remove('hidden');
window.closeAddSongModal = () => document.getElementById('addSongModal').classList.add('hidden');

window.saveNewSongToCloud = async () => {
    const artist = document.getElementById('newSongArtist').value.trim();
    const title = document.getElementById('newSongTitle').value.trim();
    const key = document.getElementById('newSongKey').value.trim().toUpperCase() || 'C';
    const text = document.getElementById('newSongText').value.trim();

    if(!artist || !title || !text) {
        alert("Please fill in Artist, Title, and Text!");
        return;
    }

    const songId = title.toLowerCase().replace(/[^a-z0-9]/g, '_') + "_" + Math.floor(Math.random() * 1000);
    const newSongData = {
        id: songId,
        title: title,
        artist: artist,
        key: key,
        text: text
    };

    songsLibrary.push(newSongData);
    saveSongsToLocalStorage();
    renderSongList(songsLibrary);
    selectSong(songId);

    try {
        await setDoc(doc(db, "songsLibrary", songId), newSongData);
        alert("Successfully saved locally and uploaded to the Cloud!");
    } catch(e) {
        alert("Saved locally, but offline so not uploaded to cloud yet.");
    }

    closeAddSongModal();
    
    document.getElementById('newSongArtist').value = '';
    document.getElementById('newSongTitle').value = '';
    document.getElementById('newSongKey').value = '';
    document.getElementById('newSongText').value = '';
}
