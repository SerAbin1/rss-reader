package io.github.serabin1.rssreader.data

import androidx.room.AutoMigration
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

// Curated and personal feeds share one table, told apart by `curated`, rather
// than the web app's split (personal in IndexedDB, curated fetched each load):
// both need a cached siteUrl and last error, and the unread counts join
// against both. Only personal rows ever take part in sync.
@Entity(tableName = "feed")
data class FeedEntity(
    @PrimaryKey val feedUrl: String,
    val title: String,
    val siteUrl: String?,
    val curated: Boolean,
    // Why the last fetch failed; null once one succeeds.
    val lastError: String?,
    // Whether a background refresh posts a notification for each new post.
    // This device only — sync knows nothing of it.
    @ColumnInfo(defaultValue = "0") val notify: Boolean = false,
)

// A list cache, not an offline store: just enough to show what a background
// refresh found the next time the app opens. Posts are read in the browser.
// A post stops being stored once it's read — publishedAt at or before the
// watermark — and is deleted at the next refresh or launch. Until then it
// stays listed, greyed out, so a post doesn't vanish the moment it's opened.
// Favourites are exempt and kept indefinitely (on this device only — sync
// knows nothing of them); feedTitle is a copy so a favourite still says where
// it came from after its feed is unsubscribed.
@Entity(
    tableName = "article",
    primaryKeys = ["feedUrl", "guid"],
    indices = [Index("publishedAt"), Index("favourite")],
)
data class ArticleEntity(
    val feedUrl: String,
    val guid: String,
    val feedTitle: String,
    val title: String,
    val link: String,
    val publishedAt: Long,
    val favourite: Boolean = false,
)

// A list row: the article plus its feed's current title.
data class ArticleRow(
    val feedUrl: String,
    val guid: String,
    val feedTitle: String,
    val title: String,
    val link: String,
    val publishedAt: Long,
    val favourite: Boolean,
)

data class FeedCount(
    val feedUrl: String,
    val count: Int,
)

// One ordering everywhere "next unread" is decided — the list, the reader's
// Next button and the watermark rule must agree on which post comes first,
// including among posts with the same timestamp.
private const val UNREAD_ORDER = "a.publishedAt, a.feedUrl, a.guid"

@Dao
interface FeedDao {
    @Query("SELECT * FROM feed ORDER BY curated, title COLLATE NOCASE")
    fun observeAll(): Flow<List<FeedEntity>>

    @Query("SELECT * FROM feed")
    suspend fun all(): List<FeedEntity>

    @Query("SELECT * FROM feed WHERE feedUrl = :feedUrl")
    suspend fun get(feedUrl: String): FeedEntity?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertNew(feeds: List<FeedEntity>)

    @Upsert
    suspend fun upsert(feeds: List<FeedEntity>)

    @Query("UPDATE feed SET siteUrl = COALESCE(:siteUrl, siteUrl), lastError = NULL WHERE feedUrl = :feedUrl")
    suspend fun markFetched(
        feedUrl: String,
        siteUrl: String?,
    )

    @Query("UPDATE feed SET lastError = :error WHERE feedUrl = :feedUrl")
    suspend fun markFailed(
        feedUrl: String,
        error: String,
    )

    @Query("UPDATE feed SET notify = :notify WHERE feedUrl = :feedUrl")
    suspend fun setNotify(
        feedUrl: String,
        notify: Boolean,
    )

    @Query("SELECT COUNT(*) FROM feed WHERE lastError IS NOT NULL")
    suspend fun failedCount(): Int

    @Query("DELETE FROM feed WHERE feedUrl IN (:feedUrls)")
    suspend fun delete(feedUrls: List<String>)
}

@Dao
interface ArticleDao {
    // Row ids in input order, -1 where the post was already stored.
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertNew(articles: List<ArticleEntity>): List<Long>

    @Query(
        """SELECT a.feedUrl, a.guid, f.title AS feedTitle, a.title, a.link, a.publishedAt, a.favourite
           FROM article a JOIN feed f ON f.feedUrl = a.feedUrl
           WHERE a.publishedAt > :after ORDER BY $UNREAD_ORDER""",
    )
    fun observeListed(after: Long): Flow<List<ArticleRow>>

    @Query(
        """SELECT a.feedUrl, a.guid, COALESCE(f.title, a.feedTitle) AS feedTitle, a.title, a.link, a.publishedAt, a.favourite
           FROM article a LEFT JOIN feed f ON f.feedUrl = a.feedUrl
           WHERE a.favourite = 1 ORDER BY a.publishedAt DESC""",
    )
    fun observeFavourites(): Flow<List<ArticleRow>>

    @Query("SELECT COUNT(*) FROM article WHERE favourite = 1")
    fun observeFavouriteCount(): Flow<Int>

    @Query("UPDATE article SET favourite = :favourite WHERE feedUrl = :feedUrl AND guid = :guid")
    suspend fun setFavourite(
        feedUrl: String,
        guid: String,
        favourite: Boolean,
    )

    @Query(
        """SELECT a.feedUrl, a.guid, f.title AS feedTitle, a.title, a.link, a.publishedAt, a.favourite
           FROM article a JOIN feed f ON f.feedUrl = a.feedUrl
           WHERE a.publishedAt > :after ORDER BY $UNREAD_ORDER LIMIT 1""",
    )
    suspend fun firstUnread(after: Long): ArticleRow?

    @Query(
        """SELECT COUNT(*) FROM article a JOIN feed f ON f.feedUrl = a.feedUrl
           WHERE a.publishedAt > :after AND a.publishedAt <= :upTo""",
    )
    suspend fun countUnreadUpTo(
        after: Long,
        upTo: Long,
    ): Int

    @Query("SELECT MAX(a.publishedAt) FROM article a JOIN feed f ON f.feedUrl = a.feedUrl WHERE a.publishedAt > :after")
    suspend fun lastUnreadPublishedAt(after: Long): Long?

    @Query("SELECT feedUrl, COUNT(*) AS count FROM article WHERE publishedAt > :after GROUP BY feedUrl")
    fun observeUnreadCounts(after: Long): Flow<List<FeedCount>>

    @Query("DELETE FROM article WHERE favourite = 0 AND publishedAt <= :watermark")
    suspend fun pruneRead(watermark: Long)

    @Query("DELETE FROM article WHERE favourite = 0 AND feedUrl IN (:feedUrls)")
    suspend fun deleteForFeeds(feedUrls: List<String>)
}

// A real migration, unlike the destructive fallback in RssApp: rebuilding the
// tables would lose favourites and make every stored post look new, so the
// next background refresh would notify all of them.
@Database(
    entities = [FeedEntity::class, ArticleEntity::class],
    version = 3,
    autoMigrations = [AutoMigration(from = 2, to = 3)],
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun feedDao(): FeedDao

    abstract fun articleDao(): ArticleDao
}
