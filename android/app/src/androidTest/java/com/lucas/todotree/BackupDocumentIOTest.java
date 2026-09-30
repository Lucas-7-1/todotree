package com.lucas.todotree;

import static org.junit.Assert.*;
import android.content.Context;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.*;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BackupDocumentIOTest {
    @Test public void savedDocumentIsClosedAndReadBackByteForByte() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = File.createTempFile("backup-test-", ".json", context.getCacheDir());
        try {
            byte[] bytes = "{\"任务\":\"旧版→新版🍜\"}".getBytes(StandardCharsets.UTF_8);
            BackupDocumentIO.writeVerified(context.getContentResolver(), Uri.fromFile(file), bytes);
            assertArrayEquals(bytes, BackupDocumentIO.read(new FileInputStream(file)));
        } finally { file.delete(); }
    }
    @Test public void closeFailureDoesNotBecomeSuccessfulExport() throws Exception {
        OutputStream failing = new ByteArrayOutputStream() {
            @Override public void close() throws IOException { throw new IOException("provider close failed"); }
        };
        try { BackupDocumentIO.write(failing, "{}".getBytes(StandardCharsets.UTF_8)); fail("close failure ignored"); }
        catch (IOException expected) { assertEquals("provider close failed", expected.getMessage()); }
    }
    @Test public void nativeReaderHandlesOldWindowsEncodingsWithoutChangingFacts() throws Exception {
        String json = "{\"title\":\"旅行记录\"}";
        assertEquals(json, BackupDocumentIO.decode(("\uFEFF" + json).getBytes(StandardCharsets.UTF_8)));
        assertEquals(json, BackupDocumentIO.decode(("\uFEFF" + json).getBytes(StandardCharsets.UTF_16LE)));
        assertEquals(json, BackupDocumentIO.decode(("\uFEFF" + json).getBytes(StandardCharsets.UTF_16BE)));
        try { BackupDocumentIO.decode(new byte[]{(byte)0xc3, 0x28}); fail("invalid bytes replaced silently"); }
        catch (CharacterCodingException expected) { }
    }
    @Test public void unreadableAndOversizeDocumentsCannotCrossTheBridge() throws Exception {
        try { BackupDocumentIO.read(null); fail("unavailable document accepted"); }
        catch (IOException expected) { }
        InputStream huge = new InputStream() {
            int remaining = BackupDocumentIO.MAX_BYTES + 1;
            @Override public int read() { return remaining-- > 0 ? 0 : -1; }
            @Override public int read(byte[] b, int off, int len) {
                if (remaining <= 0) return -1;
                int n = Math.min(remaining, len); Arrays.fill(b, off, off + n, (byte)0); remaining -= n; return n;
            }
        };
        try { BackupDocumentIO.read(huge); fail("oversize document accepted"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("32 MB")); }
    }
    @Test public void emptyExportIsRejectedBeforeTruncatingExistingFile() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = File.createTempFile("valuable-backup-", ".json", context.getCacheDir());
        try {
            byte[] original = "{\"valuable\":true}".getBytes(StandardCharsets.UTF_8);
            BackupDocumentIO.write(new FileOutputStream(file), original);
            try { BackupDocumentIO.writeVerified(context.getContentResolver(), Uri.fromFile(file), new byte[0]); fail("empty export accepted"); }
            catch (IOException expected) { }
            assertArrayEquals(original, BackupDocumentIO.read(new FileInputStream(file)));
        } finally { file.delete(); }
    }
}
