package com.jifo.app.notes

import android.text.Layout
import android.text.StaticLayout
import android.text.TextUtils
import android.text.method.LinkMovementMethod
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.databinding.ItemNoteBinding
import com.jifo.app.core.model.NoteBlock

// 与 web 端 NoteCard 保持一致：正文超过 6 个非空行即折叠预览。
private const val MAX_PREVIEW_LINES = 6

class NoteAdapter(
    private val onMoreClick: ((NoteEntity, View) -> Unit)? = null,
    private val onTagClick: ((String) -> Unit)? = null,
    private val onTaskClick: ((NoteEntity, Int) -> Unit)? = null,
    private val onExpandClick: ((NoteEntity) -> Unit)? = null
) : ListAdapter<NoteEntity, NoteAdapter.NoteViewHolder>(Diff) {
    var selectedTagPath: String? = null
        set(value) {
            if (field != value) {
                field = value
                notifyDataSetChanged()
            }
        }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): NoteViewHolder = NoteViewHolder(ItemNoteBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: NoteViewHolder, position: Int) =
        holder.bind(getItem(position), selectedTagPath, onMoreClick, onTagClick, onTaskClick, onExpandClick)

    class NoteViewHolder(private val binding: ItemNoteBinding) : RecyclerView.ViewHolder(binding.root) {
        private val markdownRenderer = NoteMarkdownRenderer(binding.root.context)

        fun bind(
            note: NoteEntity,
            selectedTagPath: String?,
            onMoreClick: ((NoteEntity, View) -> Unit)?,
            onTagClick: ((String) -> Unit)?,
            onTaskClick: ((NoteEntity, Int) -> Unit)?,
            onExpandClick: ((NoteEntity) -> Unit)?
        ) {
            binding.textNoteTime.text = note.createdAt.replace('T', ' ').take(19)
            val blocks = NoteJson.decodeBlocks(note.contentJson)
            val displayText = blocks.filterIsInstance<NoteBlock.Paragraph>().joinToString("\n\n") { it.text }.ifBlank { note.plainText }
            binding.textNoteContent.text = markdownRenderer.render(
                binding.root.context,
                displayText,
                selectedTagPath,
                onTagClick,
                onTaskClick?.let { callback -> { taskIndex -> callback(note, taskIndex) } }
            )
            binding.textNoteContent.movementMethod = LinkMovementMethod.getInstance()
            binding.textNoteContent.highlightColor = android.graphics.Color.TRANSPARENT
            binding.textNoteContent.maxLines = MAX_PREVIEW_LINES
            binding.textNoteContent.ellipsize = TextUtils.TruncateAt.END
            binding.buttonNoteMore.visibility = if (onMoreClick == null) View.GONE else View.VISIBLE
            binding.buttonNoteMore.setOnClickListener { anchor -> onMoreClick?.invoke(note, anchor) }
            binding.buttonNoteExpand.setOnClickListener { onExpandClick?.invoke(note) }
            // 行数判定依赖真实宽度，等布局完成后按完整文本测量；结果只影响按钮显隐，
            // 内容本身始终受 maxLines 约束，不会撑高卡片。
            binding.buttonNoteExpand.visibility = View.GONE
            if (onExpandClick != null) {
                binding.textNoteContent.post {
                    val overflows = displayText.lines().count { it.isNotBlank() } > MAX_PREVIEW_LINES ||
                        visualLineCount(binding.textNoteContent) > MAX_PREVIEW_LINES
                    binding.buttonNoteExpand.visibility = if (overflows) View.VISIBLE else View.GONE
                }
            }
            binding.noteImages.removeAllViews()
            blocks.filterIsInstance<NoteBlock.Image>().forEach { image ->
                if (image.mediaId == null && OfflineMediaRepository.localId(image.url) == null) return@forEach
                val imageView = ImageView(binding.root.context).apply {
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(190)).apply { bottomMargin = dp(6) }
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    contentDescription = image.alt ?: "笔记图片"
                    setBackgroundColor(android.graphics.Color.rgb(232, 226, 216))
                }
                binding.noteImages.addView(imageView)
                image.mediaId?.let { MediaImageLoader.load(binding.root.context, it, imageView) }
                    ?: MediaImageLoader.loadLocal(binding.root.context, image.url.orEmpty(), imageView)
            }
        }

        private fun dp(value: Int) = (value * binding.root.resources.displayMetrics.density).toInt()
    }

    object Diff : DiffUtil.ItemCallback<NoteEntity>() {
        override fun areItemsTheSame(oldItem: NoteEntity, newItem: NoteEntity): Boolean = oldItem.id == newItem.id
        override fun areContentsTheSame(oldItem: NoteEntity, newItem: NoteEntity): Boolean = oldItem == newItem
    }
}

// 按 TextView 的真实宽度与字体度量重新排版完整文本，得到未限行时的视觉行数。
private fun visualLineCount(textView: TextView): Int {
    val width = textView.width - textView.paddingLeft - textView.paddingRight
    if (width <= 0) return 0
    val text = textView.text ?: return 0
    return StaticLayout.Builder
        .obtain(text, 0, text.length, textView.paint, width)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
        .setLineSpacing(textView.lineSpacingExtra, textView.lineSpacingMultiplier)
        .setIncludePad(false)
        .build()
        .lineCount
}
