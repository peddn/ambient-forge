//! LAN-Adressen und die Beschreibung von Browsern.

use std::net::{IpAddr, Ipv4Addr};

fn rank(ip: Ipv4Addr) -> u8 {
    match ip.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        [172, 16..=31, ..] => 2,
        _ => 3,
    }
}

/// IPv4-Adressen dieses Rechners, die typische Heimnetz-Adresse zuerst.
pub fn lan_hosts() -> Vec<String> {
    let mut hosts: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|interface| !interface.is_loopback())
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(ip) if !ip.is_link_local() => Some(ip),
            _ => None,
        })
        .collect();
    hosts.sort_by_key(|ip| (rank(*ip), ip.octets()));
    hosts.dedup();
    hosts.iter().map(Ipv4Addr::to_string).collect()
}

pub fn client_name(user_agent: &str) -> String {
    let contains = |needle: &str| user_agent.contains(needle);

    let browser = if contains("Firefox/") {
        "Firefox"
    } else if contains("Edg/") {
        "Edge"
    } else if contains("OPR/") {
        "Opera"
    } else if contains("SamsungBrowser/") {
        "Samsung Internet"
    } else if contains("Chrome/") {
        "Chrome"
    } else if contains("Safari/") {
        "Safari"
    } else {
        "Browser"
    };

    let system = if contains("Tizen") {
        "Samsung-TV"
    } else if contains("Web0S") {
        "LG-TV"
    } else if contains("Android") {
        "Android"
    } else if contains("iPhone") {
        "iPhone"
    } else if contains("iPad") {
        "iPad"
    } else if contains("Windows") {
        "Windows"
    } else if contains("Mac OS X") {
        "macOS"
    } else if contains("Linux") {
        "Linux"
    } else {
        "unbekanntem System"
    };

    format!("{browser} auf {system}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beschreibt_browser() {
        let firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
        assert_eq!(client_name(firefox), "Firefox auf Linux");
        let android =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
        assert_eq!(client_name(android), "Chrome auf Android");
        assert_eq!(client_name(""), "Browser auf unbekanntem System");
    }

    #[test]
    fn heimnetz_steht_vorn() {
        assert!(rank(Ipv4Addr::new(192, 168, 1, 2)) < rank(Ipv4Addr::new(10, 0, 0, 5)));
        assert!(rank(Ipv4Addr::new(10, 0, 0, 5)) < rank(Ipv4Addr::new(172, 17, 0, 1)));
    }
}
