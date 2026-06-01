package com.jifo.app.notes

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.databinding.ItemNoteBinding

class NoteAdapter(
    private val onMoreClick: ((NoteEntity, View) -> Unit)? = null
) : ListAdapter<NoteEntity, NoteAdapter.NoteViewHolder>(Diff) {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): NoteViewHolder = NoteViewHolder(ItemNoteBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: NoteViewHolder, position: Int) = holder.bind(getItem(position), onMoreClick)

    class NoteViewHolder(private val binding: ItemNoteBinding) : RecyclerView.ViewHolder(binding.root) {
        fun bind(note: NoteEntity, onMoreClick: ((NoteEntity, View) -> Unit)?) {
            binding.textNoteTime.text = note.createdAt.replace('T', ' ').take(19)
            binding.textNoteContent.text = note.plainText
            binding.buttonNoteMore.visibility = if (onMoreClick == null) View.GONE else View.VISIBLE
            binding.buttonNoteMore.setOnClickListener { anchor -> onMoreClick?.invoke(note, anchor) }
        }
    }

    object Diff : DiffUtil.ItemCallback<NoteEntity>() {
        override fun areItemsTheSame(oldItem: NoteEntity, newItem: NoteEntity): Boolean = oldItem.id == newItem.id
        override fun areContentsTheSame(oldItem: NoteEntity, newItem: NoteEntity): Boolean = oldItem == newItem
    }
}
