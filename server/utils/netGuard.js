const net = require('net');

/**
 * SSRF guard for peer addresses.
 *
 * The previous checks were bare prefix regexes (`/^10\./` and friends), which
 * accept far more than IP addresses. "10.0.0.1@attacker.com" matches, and once
 * it is interpolated into a URL the "10.0.0.1" becomes userinfo, so the request
 * actually goes to attacker.com. "192.168.1.1.attacker.com" matches too.
 *
 * We therefore require a syntactically valid bare IPv4 literal first, then
 * range-check the parsed octets.
 *
 * @param {string} ip Candidate address.
 * @returns {boolean} True only for RFC 1918 LAN addresses.
 */
function isPrivateIp(ip) {
    // net.isIPv4 returns a boolean, not the 4 that net.isIP returns. Comparing
    // it against 4 was always true, so every address was rejected and all LAN
    // peer sync failed closed.
    if (typeof ip !== 'string' || !net.isIPv4(ip)) return false;

    const octets = ip.split('.').map(Number);
    const [a, b] = octets;

    // Loopback, link-local (cloud metadata lives at 169.254.169.254),
    // multicast, broadcast and 0.0.0.0/8 are all rejected.
    if (a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a >= 224) return false;
    if (ip === '255.255.255.255') return false;

    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;

    return false;
}

/**
 * Validate a peer address and return it, or throw. Use at the top of any
 * handler that is about to build an outbound URL from user input.
 */
function assertPrivateIp(ip) {
    if (!isPrivateIp(ip)) {
        throw new Error('Invalid peer IP: must be a private IPv4 LAN address');
    }
    return ip;
}

/** Coerce a value into a valid TCP port number, or return the fallback. */
function safePort(value, fallback) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
    return port;
}

module.exports = { isPrivateIp, assertPrivateIp, safePort };
