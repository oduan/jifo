package com.jifo.app.drawer

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.data.local.TagEntity

class TagAdapter(private val onClick: (TagEntity) -> Unit) : RecyclerView.Adapter<TagAdapter.ViewHolder>() {
    private val items = mutableListOf<TagEntity>()

    fun submitList(next: List<TagEntity>) {
        items.clear()
        items.addAll(next)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(android.R.layout.simple_list_item_1, parent, false) as TextView
        view.textSize = 14f
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = items[position]
        holder.text.text = "${"  ".repeat(item.depth)}#${item.name}  ${item.noteCount}"
        holder.text.setOnClickListener { onClick(item) }
    }

    override fun getItemCount(): Int = items.size

    class ViewHolder(val text: TextView) : RecyclerView.ViewHolder(text)
}
