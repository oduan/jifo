package com.jifo.app.notes

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.TextView

object NoteActionPopup {
    fun show(anchor: View, onCopy: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
        val context = anchor.context
        val popup = PopupWindow(context)
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(com.jifo.app.R.drawable.bg_note_action_popup)
            clipToOutline = true
            addView(row(context, "复制") { popup.dismiss(); onCopy() })
            addView(row(context, "编辑") { popup.dismiss(); onEdit() })
            addView(row(context, "删除") { popup.dismiss(); onDelete() })
        }
        popup.contentView = container
        popup.width = dp(anchor, 96)
        popup.height = ViewGroup.LayoutParams.WRAP_CONTENT
        popup.isFocusable = true
        popup.isOutsideTouchable = true
        popup.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        popup.elevation = dp(anchor, 6).toFloat()
        popup.showAsDropDown(anchor, -dp(anchor, 88), 0, Gravity.NO_GRAVITY)
    }

    private fun row(context: Context, text: String, action: () -> Unit): TextView = TextView(context).apply {
        this.text = text
        textSize = 14f
        setTextColor(Color.rgb(32, 27, 22))
        setBackgroundColor(Color.TRANSPARENT)
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(this, 12), 0, dp(this, 12), 0)
        minHeight = dp(this, 40)
        setOnClickListener { action() }
    }

    private fun dp(view: View, value: Int): Int = (value * view.resources.displayMetrics.density).toInt()
}
