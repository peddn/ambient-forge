//! Erkennt den Dateityp am Inhalt, nicht an der Endung.

use crate::model::AssetKind;

pub const HEAD_LEN: usize = 64;

#[derive(Debug, PartialEq, Eq)]
pub struct Sniffed {
    pub kind: AssetKind,
    pub mime: &'static str,
    pub ext: &'static str,
}

const fn image(mime: &'static str, ext: &'static str) -> Sniffed {
    Sniffed {
        kind: AssetKind::Image,
        mime,
        ext,
    }
}

const fn audio(mime: &'static str, ext: &'static str) -> Sniffed {
    Sniffed {
        kind: AssetKind::Audio,
        mime,
        ext,
    }
}

fn is_mp3_frame(head: &[u8]) -> bool {
    head.len() >= 2 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0 && (head[1] >> 1) & 0x03 != 0
}

pub fn sniff(head: &[u8]) -> Option<Sniffed> {
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(image("image/jpeg", "jpg"));
    }
    if head.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some(image("image/png", "png"));
    }
    if head.len() >= 12 && head.starts_with(b"RIFF") {
        return match &head[8..12] {
            b"WEBP" => Some(image("image/webp", "webp")),
            b"WAVE" => Some(audio("audio/wav", "wav")),
            _ => None,
        };
    }
    if head.starts_with(b"fLaC") {
        return Some(audio("audio/flac", "flac"));
    }
    if head.starts_with(b"OggS") {
        let opus = head.len() >= 36 && &head[28..36] == b"OpusHead";
        return Some(if opus {
            audio("audio/ogg", "opus")
        } else {
            audio("audio/ogg", "ogg")
        });
    }
    if head.starts_with(b"ID3") || is_mp3_frame(head) {
        return Some(audio("audio/mpeg", "mp3"));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn riff(form: &[u8; 4]) -> Vec<u8> {
        let mut data = b"RIFF\0\0\0\0".to_vec();
        data.extend_from_slice(form);
        data
    }

    #[test]
    fn erkennt_bilder() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap().ext, "jpg");
        assert_eq!(
            sniff(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
                .unwrap()
                .ext,
            "png"
        );
        assert_eq!(sniff(&riff(b"WEBP")).unwrap().ext, "webp");
    }

    #[test]
    fn erkennt_audio() {
        assert_eq!(sniff(&riff(b"WAVE")).unwrap().ext, "wav");
        assert_eq!(sniff(b"fLaC\0").unwrap().ext, "flac");
        assert_eq!(sniff(b"ID3\x04").unwrap().ext, "mp3");
        assert_eq!(sniff(&[0xFF, 0xFB, 0x90, 0x00]).unwrap().ext, "mp3");
        assert_eq!(sniff(b"OggS\0").unwrap().ext, "ogg");

        let mut opus = b"OggS".to_vec();
        opus.resize(28, 0);
        opus.extend_from_slice(b"OpusHead");
        assert_eq!(sniff(&opus).unwrap().ext, "opus");
    }

    #[test]
    fn lehnt_andere_inhalte_ab() {
        assert!(sniff(b"<html>").is_none());
        assert!(sniff(b"").is_none());
        assert!(sniff(&riff(b"AVI ")).is_none());
        // ADTS-AAC beginnt ähnlich wie MP3, hat aber Layer 0.
        assert!(sniff(&[0xFF, 0xF1, 0x50, 0x80]).is_none());
    }
}
