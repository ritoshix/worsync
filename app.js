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
let cloudSongsLibrary = []; 
let personalSetlist = [];   
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

window.addEventListener('DOMContentLoaded', () => {
    loadPersonalSetlist();
    initGlobalCloudLibrary();
    setupGlobalListeners();
});

function setupGlobalListeners() {
    const chordModal = document.getElementById('chordModal');
    if(chordModal) {
        chordModal.addEventListener('click', (e) => {
            if(e.target === chordModal) {
                window.closeChordModal();
            }
        });
    }
}

function loadPersonalSetlist() {
    const savedSetlist = localStorage.getItem('worsync_personal_setlist');
    if(savedSetlist) {
        try {
            personalSetlist = JSON.parse(savedSetlist);
        } catch(e) { personalSetlist = []; }
    } else {
        personalSetlist = [];
        localStorage.setItem('worsync_personal_setlist', JSON.stringify(personalSetlist));
    }

    if(personalSetlist.length > 0) {
        currentSong = personalSetlist[0];
        currentTransposeOffset = 0;
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
    try {
        const querySnapshot = await getDocs(collection(db, "songsLibrary"));
        cloudSongsLibrary = [];
        querySnapshot.forEach((doc) => {
            cloudSongsLibrary.push(doc.data());
        });
    } catch(err) {
        console.log("Offline mode: Using cached cloud data.");
    }

    onSnapshot(collection(db, "songsLibrary"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const updatedSong = change.doc.data();
            const index = cloudSongsLibrary.findIndex(s => s.id === updatedSong.id);
            if(index === -1) {
                cloudSongsLibrary.push(updatedSong);
            } else {
                cloudSongsLibrary[index] = updatedSong;
            }
            updateArtistSuggestions();
        });
    });
}

// Manual Sync Cloud Button Function inside Browse Modal
window.manualSyncCloud = async () => {
    try {
        const querySnapshot = await getDocs(collection(db, "songsLibrary"));
        let cloudCount = 0;
        
        querySnapshot.forEach((document) => {
            const cloudSong = document.data();
            const exists = cloudSongsLibrary.find(s => s.id === cloudSong.id);
            if(!exists) {
                cloudSongsLibrary.push(cloudSong);
                cloudCount++;
            }
        });

        renderCloudBrowserList(cloudSongsLibrary);
        alert(`Successfully synced! Found ${cloudCount} new song(s) from the Cloud.`);
    } catch(e) {
        alert("Sync failed. Please check your internet connection.");
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

window.closeCloudBrowser = () => {
    document.getElementById('cloudBrowserModal').classList.add('hidden');
}

window.filterCloudSongs = () => {
    const query = document.getElementById('cloudSearchInput').value.toLowerCase();
    const filtered = cloudSongsLibrary.filter(song => 
        song.title.toLowerCase().includes(query) || 
        song.artist.toLowerCase().includes(query)
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
        
        item.innerHTML = `
            <div>
                <p class="font-bold text-white">${song.title}</p>
                <p class="text-slate-400 text-[10px]">${song.artist} • Key: <span class="text-amber-400">${song.key || 'C'}</span></p>
            </div>
        `;

        const btn = document.createElement('button');
        if(isInSetlist) {
            btn.className = "bg-slate-700 text-slate-400 px-2.5 py-1 rounded text-[10px] cursor-not-allowed";
            btn.innerText = "Added";
            btn.disabled = true;
        } else {
            btn.className = "bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold px-2.5 py-1 rounded text-[10px] transition";
            btn.innerText = "+ Add to Setlist";
            btn.onclick = () => addSongToPersonalSetlist(song);
        }

        item.appendChild(btn);
        container.appendChild(item);
    });
}

async function addSongToPersonalSetlist(song) {
    const exists = personalSetlist.some(s => s.id === song.id);
    if(!exists) {
        personalSetlist.push(song);
        savePersonalSetlist();
        renderCloudBrowserList(cloudSongsLibrary);
        selectSong(song.id);

        if(isHost && currentRoomId) {
            const roomRef = doc(db, "jamRooms", currentRoomId);
            await updateDoc(roomRef, {
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
            if(personalSetlist.length > 0) {
                selectSong(personalSetlist[0].id);
            } else {
                currentSong = null;
                location.reload();
            }
        }

        if(isHost && currentRoomId) {
            const roomRef = doc(db, "jamRooms", currentRoomId);
            await updateDoc(roomRef, {
                setlist: personalSetlist.map(s => s.id),
                updatedAt: new Date()
            });
        }
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
        currentSongId: currentSong ? currentSong.id : "",
        activeSection: getFirstSectionKey(currentSong),
        hostForceFollow: true,
        setlist: personalSetlist.map(s => s.id),
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

            if(data.setlist && Array.isArray(data.setlist)) {
                let updatedSetlist = [];
                data.setlist.forEach(songId => {
                    let found = cloudSongsLibrary.find(s => s.id === songId) || personalSetlist.find(s => s.id === songId);
                    if(found) updatedSetlist.push(found);
                });
                personalSetlist = updatedSetlist;
                savePersonalSetlist();
            }

            if(data.currentSongId && (!currentSong || currentSong.id !== data.currentSongId)) {
                let found = personalSetlist.find(s => s.id === data.currentSongId) || cloudSongsLibrary.find(s => s.id === data.currentSongId);
                if(found) {
                    currentSong = found;
                    currentTransposeOffset = 0;
                    renderSetlistUI();
                    renderSongContent();
                }
            }

            if(data.activeSection) {
                highlightSection(data.activeSection);
            }
        }
    });
}

window.selectSong = async (songId) => {
    const found = personalSetlist.find(s => s.id === songId);
    if(found) {
        currentSong = found;
        currentTransposeOffset = 0;
        renderSetlistUI();
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
            lyricsCard.classList.add('host-sync-glow');
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
            lyricsCard.classList.remove('host-sync-glow');
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

function renderSetlistUI() {
    const listEl = document.getElementById('songList');
    listEl.innerHTML = '';
    
    if(personalSetlist.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">Setlist is empty.</p>`;
        return;
    }

    const grouped = {};
    personalSetlist.forEach(song => {
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
            
            const rightContainer = document.createElement('div');
            rightContainer.className = "flex items-center gap-1.5";

            const spanKey = document.createElement('span');
            spanKey.className = "text-[9px] font-mono bg-slate-800 px-1 py-0.5 rounded text-amber-400/80 border border-slate-700";
            spanKey.innerText = song.key || 'C';
            rightContainer.appendChild(spanKey);

            if(isHost) {
                const delBtn = document.createElement('span');
                delBtn.className = "text-rose-400 hover:text-rose-300 font-bold px-1 text-[11px]";
                delBtn.innerHTML = "✕";
                delBtn.title = "Remove from setlist";
                delBtn.onclick = (e) => removeSongFromSetlist(e, song.id);
                rightContainer.appendChild(delBtn);
            }

            btn.appendChild(spanTitle);
            btn.appendChild(rightContainer);
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
        return `<span class="clickable-chord" onclick="event.stopPropagation(); window.showChordModal('${match}')">${match}</span>`;
    });
}

window.showChordModal = (chordName) => {
    let cleanChord = chordName.trim();
    document.getElementById('modalChordTitle').innerText = cleanChord;
    let diag = chordDiagrams[cleanChord] || `    I  II III\ne |--|--|--|\nB |--|--|--|\nG |--|--|--|\nD |--|--|--|\nA |--|--|--|\nE |--|--|--|\n(Standard Position)`;
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

    cloudSongsLibrary.push(newSongData);
    personalSetlist.push(newSongData);
    savePersonalSetlist();
    selectSong(songId);

    if(isHost && currentRoomId) {
        const roomRef = doc(db, "jamRooms", currentRoomId);
        await updateDoc(roomRef, {
            setlist: personalSetlist.map(s => s.id),
            updatedAt: new Date()
        });
    }

    try {
        await setDoc(doc(db, "songsLibrary", songId), newSongData);
        alert("Successfully saved to Cloud and added to your Setlist!");
    } catch(e) {
        alert("Saved to setlist, but offline so not uploaded to cloud yet.");
    }

    closeAddSongModal();
    
    document.getElementById('newSongArtist').value = '';
    document.getElementById('newSongTitle').value = '';
    document.getElementById('newSongKey').value = '';
    document.getElementById('newSongText').value = '';
}
