/**
 * Byte-range request parsing.
 *
 * The previous inline parsers called parseInt without validating the result,
 * then wrote a 206 header before opening the stream. A malformed range such as
 * "bytes=abc-" produced start=NaN, createReadStream threw after the header was
 * already sent, and the catch block's res.status(500) threw again with
 * ERR_HTTP_HEADERS_SENT. Suffix ranges and out-of-bounds starts were also
 * mishandled, and there was no 416 path.
 *
 * @param {string|undefined} header Raw Range header.
 * @param {number} size Total size of the resource in bytes.
 * @returns {{start:number,end:number}|null|'unsatisfiable'}
 *   null when there is no usable range (caller should send the whole body),
 *   'unsatisfiable' when the caller should reply 416.
 */
function parseRange(header, size, maxChunk = 10 * 1024 * 1024) {
    if (!header || typeof header !== 'string') return null;
    if (size <= 0) return 'unsatisfiable';

    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null; // Multi-range and unknown units: send the whole body.

    const [, rawStart, rawEnd] = match;
    let start;
    let end;

    if (rawStart === '') {
        // Suffix range: "bytes=-500" means the last 500 bytes.
        if (rawEnd === '') return 'unsatisfiable';
        const suffix = Number(rawEnd);
        if (!Number.isInteger(suffix) || suffix <= 0) return 'unsatisfiable';
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(rawStart);
        if (!Number.isInteger(start) || start < 0) return 'unsatisfiable';
        if (start >= size) return 'unsatisfiable';
        end = rawEnd === '' ? Math.min(start + maxChunk, size - 1) : Number(rawEnd);
        if (!Number.isInteger(end) || end < start) return 'unsatisfiable';
        end = Math.min(end, size - 1);
    }

    return { start, end };
}

/** Send the standard 416 response for an unsatisfiable range. */
function sendUnsatisfiable(res, size) {
    res.writeHead(416, {
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes'
    });
    res.end();
}

module.exports = { parseRange, sendUnsatisfiable };
