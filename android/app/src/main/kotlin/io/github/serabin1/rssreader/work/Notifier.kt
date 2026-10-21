package io.github.serabin1.rssreader.work

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.serabin1.rssreader.MainActivity
import io.github.serabin1.rssreader.R
import io.github.serabin1.rssreader.data.ArticleEntity

// One notification per new post — no grouping summary, no "N new posts".
// Each is tagged by its post, so a post never notifies twice over itself, and
// any of them opens the app on Unread.
object Notifier {
    private const val CHANNEL = "new-posts"

    fun postNew(context: Context, posts: List<ArticleEntity>) {
        if (posts.isEmpty()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = NotificationManagerCompat.from(context)
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_DEFAULT)
                .setName("New posts")
                .build(),
        )
        val open = PendingIntent.getActivity(context, 0, MainActivity.openUnread(context), PendingIntent.FLAG_IMMUTABLE)
        for (post in posts.sortedBy { it.publishedAt }) {
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(post.title.ifBlank { post.feedTitle })
                .setContentText(post.feedTitle)
                .setWhen(post.publishedAt)
                .setShowWhen(true)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            manager.notify("${post.feedUrl} ${post.guid}", 0, notification)
        }
    }
}
