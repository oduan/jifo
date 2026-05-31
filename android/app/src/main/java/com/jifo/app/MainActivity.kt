package com.jifo.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.jifo.app.notes.NotesFragment

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction()
                .replace(R.id.main_container, NotesFragment())
                .commit()
        }
    }
}
