use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Feed {
    pub feedUrl: String,
    pub title: String,
    pub siteUrl: Option<String>,
}

impl Default for Feed {
    fn default() -> Self {
        Self {
            feedUrl: String::new(),
            title: String::new(),
            siteUrl: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Post {
    pub feedUrl: String,
    pub guid: String,
    pub title: String,
    pub link: String,
    pub publishedAt: String,
}

impl Default for Post {
    fn default() -> Self {
        Self {
            feedUrl: String::new(),
            guid: String::new(),
            title: String::new(),
            link: String::new(),
            publishedAt: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedFeed {
    pub title: Option<String>,
    pub siteUrl: Option<String>,
    pub posts: Vec<Post>,
}

impl Default for ParsedFeed {
    fn default() -> Self {
        Self {
            title: None,
            siteUrl: None,
            posts: Vec::new(),
        }
    }
}