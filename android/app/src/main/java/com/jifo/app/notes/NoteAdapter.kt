package com.jifo.app.notes

import android.text.method.LinkMovementMethod
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.databinding.ItemNoteBinding
import com.jifo.app.core.model.NoteBlock

class NoteAdapter(
    private val onMoreClick: ((NoteEntity, View) -> Unit)? = null,
    private val onTagClick: ((String) -> Unit)? = null,
    private val onTaskClick: ((NoteEntity, Int) -> Unit)? = null
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
        holder.bind(getItem(position), selectedTagPath, onMoreClick, onTagClick, onTaskClick)

    class NoteViewHolder(private val binding: ItemNoteBinding) : RecyclerView.ViewHolder(binding.root) {
        private val markdownRenderer = NoteMarkdownRenderer(binding.root.context)

        fun bind(
            note: NoteEntity,
            selectedTagPath: String?,
            onMoreClick: ((NoteEntity, View) -> Unit)?,
            onTagClick: ((String) -> Unit)?,
            onTaskClick: ((NoteEntity, Int) -> Unit)?
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
            binding.buttonNoteMore.visibility = if (onMoreClick == null) View.GONE else View.VISIBLE
            binding.buttonNoteMore.setOnClickListener { anchor -> onMoreClick?.invoke(note, anchor) }
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
