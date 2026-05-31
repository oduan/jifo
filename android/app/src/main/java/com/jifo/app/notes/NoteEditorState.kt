package com.jifo.app.notes

data class NoteEditorState(val text: String) { val canSend: Boolean = text.trim().isNotEmpty() }
