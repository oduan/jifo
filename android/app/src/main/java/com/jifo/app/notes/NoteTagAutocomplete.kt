package com.jifo.app.notes

import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.ScrollView
import android.widget.TextView
import com.jifo.app.data.local.TagEntity
import kotlin.math.max

internal data class NoteTagTrigger(val hashStart: Int, val caret: Int, val query: String)

internal sealed class NoteTagSuggestion {
    abstract val key: String
    abstract val label: String

    data class Existing(val tag: TagEntity) : NoteTagSuggestion() {
        override val key: String = tag.id
        override val label: String = tag.path.ifBlank { tag.name }
    }

    data class Create(override val label: String) : NoteTagSuggestion() {
        override val key: String = "create:$label"
    }
}

internal object NoteTagAutocompleteEngine {
    fun findTrigger(text: String, caret: Int): NoteTagTrigger? {
        val safeCaret = caret.coerceIn(0, text.length)
        val before = text.substring(0, safeCaret)
        val after = text.substring(safeCaret)
        if (after.isNotEmpty() && !after.first().isWhitespace()) return null
        val match = Regex("(^|\\s)#([^\\s#]*)$").find(before) ?: return null
        val prefix = match.groupValues[1]
        return NoteTagTrigger(
            hashStart = match.range.first + prefix.length,
            caret = safeCaret,
            query = match.groupValues[2]
        )
    }

    fun suggestions(tags: List<TagEntity>, query: String): List<NoteTagSuggestion> {
        val normalized = query.trim().lowercase()
        val matches = tags
            .asSequence()
            .filter { it.path.isNotBlank() || it.name.isNotBlank() }
            .distinctBy { it.id }
            .filter { tag ->
                val label = tag.path.ifBlank { tag.name }
                normalized.isBlank() || label.lowercase().contains(normalized) || tag.name.lowercase().contains(normalized)
            }
            .map { NoteTagSuggestion.Existing(it) }
            .toList()
        val createLabel = query.trim()
        return if (matches.isEmpty() && createLabel.isNotBlank()) listOf(NoteTagSuggestion.Create(createLabel)) else matches
    }
}

class NoteTagAutocomplete(
    private val editText: EditText,
    private var tags: List<TagEntity> = emptyList()
) {
    private var popup: PopupWindow? = null
    private var trigger: NoteTagTrigger? = null
    private var suggestions: List<NoteTagSuggestion> = emptyList()
    private var focusedIndex = 0
    private var suppressTextChange = false
    private var skipNextRefresh = false
    private var textBeforeChange = ""

    private val watcher = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
            textBeforeChange = s?.toString().orEmpty()
        }

        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
            if (suppressTextChange || count <= 0) return
            val inserted = s?.subSequence(start, (start + count).coerceAtMost(s.length))?.toString().orEmpty()
            if (inserted == "\n" && popup?.isShowing == true) {
                val item = suggestions.getOrNull(focusedIndex) ?: suggestions.firstOrNull() ?: return
                skipNextRefresh = true
                suppressTextChange = true
                editText.text?.delete(start, (start + count).coerceAtMost(editText.text?.length ?: start))
                suppressTextChange = false
                choose(item)
            } else if (inserted == "\n") {
                val continuation = MarkdownListContinuation.apply(textBeforeChange, start, start + before) ?: return
                skipNextRefresh = true
                suppressTextChange = true
                editText.setText(continuation.text)
                editText.setSelection(continuation.caret.coerceIn(0, continuation.text.length))
                suppressTextChange = false
            }
        }
        override fun afterTextChanged(s: Editable?) {
            if (suppressTextChange) return
            if (skipNextRefresh) {
                skipNextRefresh = false
                return
            }
            refresh()
        }
    }

    init {
        editText.addTextChangedListener(watcher)
        editText.setOnClickListener { refresh() }
        editText.setOnFocusChangeListener { _, hasFocus -> if (!hasFocus) dismiss() else refresh() }
        editText.setOnKeyListener { _, keyCode, event -> handleKey(keyCode, event) }
    }

    fun updateTags(next: List<TagEntity>) {
        tags = next
        refresh()
    }

    fun detach() {
        editText.removeTextChangedListener(watcher)
        dismiss()
    }

    private fun handleKey(keyCode: Int, event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN || popup?.isShowing != true || suggestions.isEmpty()) return false
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                focusedIndex = (focusedIndex + 1) % suggestions.size
                showPopup()
                true
            }
            KeyEvent.KEYCODE_DPAD_UP -> {
                focusedIndex = (focusedIndex - 1 + suggestions.size) % suggestions.size
                showPopup()
                true
            }
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_DPAD_CENTER -> {
                choose(suggestions.getOrNull(focusedIndex) ?: suggestions.first())
                true
            }
            KeyEvent.KEYCODE_ESCAPE, KeyEvent.KEYCODE_BACK -> {
                dismiss()
                true
            }
            else -> false
        }
    }

    private fun refresh() {
        val text = editText.text?.toString().orEmpty()
        val caret = editText.selectionStart.coerceAtLeast(0)
        val nextTrigger = NoteTagAutocompleteEngine.findTrigger(text, caret)
        trigger = nextTrigger
        if (nextTrigger == null) {
            dismiss()
            return
        }
        suggestions = NoteTagAutocompleteEngine.suggestions(tags, nextTrigger.query)
        focusedIndex = 0
        if (suggestions.isEmpty()) dismiss() else showPopup()
    }

    private fun choose(item: NoteTagSuggestion) {
        val activeTrigger = trigger ?: return
        val editable = editText.text ?: return
        val beforeHash = editable.substring(0, activeTrigger.hashStart)
        val afterCaret = editable.substring(activeTrigger.caret).trimStart()
        val inserted = "#${item.label} "
        val next = beforeHash + inserted + afterCaret
        val nextCaret = beforeHash.length + inserted.length
        suppressTextChange = true
        editText.setText(next)
        editText.setSelection(nextCaret.coerceIn(0, next.length))
        suppressTextChange = false
        dismiss()
    }

    private fun showPopup() {
        if (!editText.isAttachedToWindow || suggestions.isEmpty()) return
        val context = editText.context
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(5), dp(5), dp(5), dp(5))
            background = roundedDrawable(Color.WHITE, dp(9).toFloat())
        }
        suggestions.forEachIndexed { index, item ->
            container.addView(row(item, index == focusedIndex) { choose(item) })
        }
        val width = dp(180)
        val anchor = popupAnchor()
        val maxHeight = availableDropdownHeightAbove(anchor.lineTop)
        val scroll = MaxHeightScrollView(context, maxHeight).apply {
            isFillViewport = false
            addView(container, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        val height = measurePopupHeight(scroll, width, maxHeight)
        val placement = popupPlacementAbove(anchor, height)
        val existing = popup
        if (existing == null) {
            popup = PopupWindow(scroll, width, height, false).apply {
                isOutsideTouchable = true
                isClippingEnabled = false
                elevation = dp(8).toFloat()
            }
        } else {
            existing.contentView = scroll
            existing.width = width
            existing.height = height
        }
        val p = popup ?: return
        if (p.isShowing) {
            p.update(placement.x, placement.y, width, height)
        } else {
            p.showAtLocation(editText.rootView, Gravity.NO_GRAVITY, placement.x, placement.y)
        }
    }

    private fun row(item: NoteTagSuggestion, focused: Boolean, onClick: () -> Unit): View {
        val context = editText.context
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(7), dp(4), dp(7), dp(4))
            minimumHeight = dp(28)
            background = if (focused) roundedDrawable(0x0F201B16, dp(6).toFloat()) else null
            isClickable = true
            setOnClickListener { onClick() }
        }
        val label = TextView(context).apply {
            text = "# ${item.label}"
            textSize = 13f
            setTextColor(0xFF4D4338.toInt())
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        row.addView(label)
        if (item is NoteTagSuggestion.Create) {
            row.addView(TextView(context).apply {
                text = "新建"
                textSize = 11f
                setTextColor(0xFF817568.toInt())
                setPadding(dp(5), dp(2), dp(5), dp(2))
                background = roundedDrawable(0x1A201B16, dp(3).toFloat())
            })
        }
        return row
    }

    private fun popupAnchor(): PopupAnchor {
        val activeTrigger = trigger
        val layout = editText.layout
        val location = IntArray(2)
        editText.getLocationOnScreen(location)
        if (activeTrigger == null || layout == null) {
            return PopupAnchor(x = location[0], lineTop = location[1])
        }
        val offset = activeTrigger.hashStart.coerceIn(0, editText.text?.length ?: 0)
        val line = layout.getLineForOffset(offset)
        val hashX = layout.getPrimaryHorizontal(offset).toInt()
        val lineTop = layout.getLineTop(line)
        val x = location[0] + editText.totalPaddingLeft + hashX - editText.scrollX
        val y = location[1] + editText.totalPaddingTop + lineTop - editText.scrollY
        val maxX = editText.resources.displayMetrics.widthPixels - dp(188)
        return PopupAnchor(x = max(0, x.coerceAtMost(maxX)), lineTop = max(0, y))
    }

    private fun popupPlacementAbove(anchor: PopupAnchor, popupHeight: Int): PopupPlacement {
        val visibleFrame = Rect()
        editText.rootView.getWindowVisibleDisplayFrame(visibleFrame)
        val visibleTop = if (visibleFrame.top > 0) visibleFrame.top else 0
        val y = (anchor.lineTop - popupHeight - dp(4)).coerceAtLeast(visibleTop + dp(8))
        return PopupPlacement(x = anchor.x, y = y)
    }

    private fun availableDropdownHeightAbove(lineTop: Int): Int {
        val visibleFrame = Rect()
        editText.rootView.getWindowVisibleDisplayFrame(visibleFrame)
        val visibleTop = if (visibleFrame.top > 0) visibleFrame.top else 0
        val availableAbove = lineTop - visibleTop - dp(12)
        return availableAbove.coerceIn(dp(48), dp(210))
    }

    private fun measurePopupHeight(view: View, width: Int, maxHeight: Int): Int {
        view.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(maxHeight, View.MeasureSpec.AT_MOST)
        )
        return view.measuredHeight.coerceIn(dp(1), maxHeight)
    }

    private data class PopupAnchor(val x: Int, val lineTop: Int)
    private data class PopupPlacement(val x: Int, val y: Int)

    private fun dismiss() {
        popup?.dismiss()
        suggestions = emptyList()
    }

    private fun roundedDrawable(color: Int, radius: Float): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
    }

    private fun dp(value: Int): Int = (value * editText.resources.displayMetrics.density).toInt()

    private class MaxHeightScrollView(context: android.content.Context, private val maxHeightPx: Int) : ScrollView(context) {
        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
            val cappedHeight = View.MeasureSpec.makeMeasureSpec(maxHeightPx, View.MeasureSpec.AT_MOST)
            super.onMeasure(widthMeasureSpec, cappedHeight)
        }
    }
}
