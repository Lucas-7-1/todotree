package com.lucas.todotree;

import android.content.ContentResolver;
import android.net.Uri;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.MessageDigest;

/** Complete streams before acknowledgement; validate the bytes actually saved by the provider. */
final class BackupDocumentIO {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    static byte[] read(InputStream source) throws IOException {
        if (source == null) throw new IOException("Document is unavailable");
        try (InputStream input = source; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = input.read(buffer)) != -1) {
                if (output.size() + n > MAX_BYTES) throw new IOException("Document exceeds 32 MB");
                output.write(buffer, 0, n);
            }
            return output.toByteArray();
        }
    }
    static String decode(byte[] bytes) throws CharacterCodingException {
        Charset charset = StandardCharsets.UTF_8;
        if (bytes.length >= 2 && bytes[0] == (byte)0xff && bytes[1] == (byte)0xfe) charset = StandardCharsets.UTF_16LE;
        else if (bytes.length >= 2 && bytes[0] == (byte)0xfe && bytes[1] == (byte)0xff) charset = StandardCharsets.UTF_16BE;
        String text = charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        return text.startsWith("\uFEFF") ? text.substring(1) : text;
    }
    static void write(OutputStream stream, byte[] bytes) throws IOException {
        if (stream == null) throw new IOException("Document is not writable");
        try (OutputStream output = stream) { output.write(bytes); output.flush(); }
        // A close failure propagates. Success cannot escape from inside this try block.
    }
    static void writeVerified(ContentResolver resolver, Uri uri, byte[] expected) throws Exception {
        if (uri == null || expected.length == 0 || expected.length > MAX_BYTES) throw new IOException("Invalid document");
        write(resolver.openOutputStream(uri, "wt"), expected);
        MessageDigest actual = MessageDigest.getInstance("SHA-256");
        int count = 0;
        InputStream source = resolver.openInputStream(uri);
        if (source == null) throw new IOException("Cannot verify saved document");
        try (InputStream input = source) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = input.read(buffer)) != -1) {
                count += n;
                if (count > MAX_BYTES) throw new IOException("Invalid saved document size");
                actual.update(buffer, 0, n);
            }
        }
        if (count != expected.length || !MessageDigest.isEqual(actual.digest(), MessageDigest.getInstance("SHA-256").digest(expected))) {
            throw new IOException("Saved document is incomplete");
        }
    }
}
