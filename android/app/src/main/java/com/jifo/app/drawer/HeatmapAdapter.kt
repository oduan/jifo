package com.jifo.app.drawer

import android.graphics.drawable.GradientDrawable
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.R
import com.jifo.app.data.local.HeatmapDayEntity

class HeatmapAdapter : RecyclerView.Adapter<HeatmapAdapter.CellHolder>() {
    private var days: List<HeatmapDayEntity> = emptyList()

    fun submitList(next: List<HeatmapDayEntity>) {
        days = next.takeLast(84)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CellHolder {
        val density = parent.resources.displayMetrics.density
        val margin = (1 * density).toInt()
        val fallbackWidth = (240 * density).toInt()
        val columnWidth = (parent.measuredWidth.takeIf { it > 0 } ?: fallbackWidth) / COLUMN_COUNT
        val size = (columnWidth - margin * 2).coerceAtLeast((12 * density).toInt())
        return CellHolder(View(parent.context).apply {
            layoutParams = ViewGroup.MarginLayoutParams(size, size).apply { setMargins(margin, margin, margin, margin) }
        })
    }

    override fun onBindViewHolder(holder: CellHolder, position: Int) = holder.bind(days[position])
    override fun getItemCount(): Int = days.size

    class CellHolder(private val cell: View) : RecyclerView.ViewHolder(cell) {
        fun bind(day: HeatmapDayEntity) {
            val color = when {
                day.totalCount >= 4 -> R.color.jifo_heatmap_3
                day.totalCount >= 2 -> R.color.jifo_heatmap_2
                day.totalCount >= 1 -> R.color.jifo_heatmap_1
                else -> R.color.jifo_heatmap_0
            }
            cell.background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = cell.resources.displayMetrics.density * 1.5f
                setColor(ContextCompat.getColor(cell.context, color))
            }
            cell.contentDescription = "${day.date}，${day.totalCount} 条笔记"
        }
    }

    companion object {
        private const val COLUMN_COUNT = 12
    }
}
