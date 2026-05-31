package com.jifo.app.notes

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteEditorStateTest {
    @Test fun sendButtonEnabledOnlyWhenTrimmedTextExists() {
        assertFalse(NoteEditorState("").canSend)
        assertFalse(NoteEditorState("   \n").canSend)
        assertTrue(NoteEditorState("hello").canSend)
    }
}
