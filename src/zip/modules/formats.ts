export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "ico", "tga", "qoi", "svg"];
export const VIDEO_EXT = ["mp4", "mkv", "mov", "webm", "avi", "wmv", "m4v", "flv", "mpg", "mpeg"];
export const AUDIO_EXT = ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "aiff", "wma", "ac3"];
export const MB = 1024 * 1024;

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const listNames = (names: string[]) => names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3} more` : "");
