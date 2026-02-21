export const formatTime = seconds => {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

export const sanitizeFileName = name => {
  return String(name || 'audio').replace(/[^\w.\-]/g, '_');
};

export const guessMetadataFromFileName = fileName => {
  const clean = String(fileName || 'Untitled').replace(/\.[^/.]+$/, '');
  const parts = clean.split(' - ').map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    return {
      title: parts.slice(1).join(' - '),
      artist: parts[0],
      album: 'Single'
    };
  }
  return { title: clean, artist: 'Unknown Artist', album: 'Single' };
};

export const byPosition = (a, b) => a.position - b.position;
export const byCreatedDesc = (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
