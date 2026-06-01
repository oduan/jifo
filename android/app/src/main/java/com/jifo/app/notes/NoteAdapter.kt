package com.jifo.app.notes

import android.text.method.LinkMovementMethod
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.databinding.ItemNoteBinding

class NoteAdapter(
    private val onMoreClick: ((NoteEntity, View) -> Unit)? = null,
    private val onTagClick: ((String) -> Unit)? = null
) : ListAdapter<NoteEntity, NoteAdapter.NoteViewHolder>(Diff) {
    var selectedTagPath: String? = null
        set(value) {
            if (field != value) {
                field = value
                notifyDataSetChanged()
            }
        }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): NoteViewHolder = NoteViewHolder(ItemNoteBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: NoteViewHolder, position: Int) = holder.bind(getItem(position), selectedTagPath, onMoreClick, onTagClick)

    class NoteViewHolder(private val binding: ItemNoteBinding) : RecyclerView.ViewHolder(binding.root) {
        fun bind(note: NoteEntity, selectedTagPath: String?, onMoreClick: ((NoteEntity, View) -> Unit)?, onTagClick: ((String) -> Unit)?) {
            binding.textNoteTime.text = note.createdAt.replace('T', ' ').take(19)
            binding.textNoteContent.text = NoteTextFormatter.format(binding.root.context, note.plainText, selectedTagPath, onTagClick)
            binding.textNoteContent.movementMethod = if (onTagClick == null) null else LinkMovementMethod.getInstance()
            binding.textNoteContent.highlightColor = android.graphics.Color.TRANSPARENT
            binding.buttonNoteMore.visibility = if (onMoreClick == null) View.GONE else View.VISIBLE
            binding.buttonNoteMore.setOnClickListener { anchor -> onMoreClick?.invoke(note, anchor) }
        }
    }

    object Diff : DiffUtil.ItemCallback<NoteEntity>() {
        override fun areItemsTheSame(oldItem: NoteEntity, newItem: NoteEntity): Boolean = oldItem.id == newItem.id
        override fun areContentsTheSame(oldItem: NoteEntity, newItem: NoteEntity): Boolean = oldItem == newItem
    }
}
