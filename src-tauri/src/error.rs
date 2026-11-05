use serde::{ser::SerializeStruct, Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Db(#[from] rusqlite::Error),
    #[error("Not found")]
    NotFound,
    #[error("{0}")]
    Invalid(String),
    #[error("No API key is set")]
    MissingKey,
    #[error("API key was rejected")]
    Unauthorized,
    #[error("Rate limit reached, try again in a moment")]
    RateLimited,
    #[error("Couldn't reach the AI service")]
    Network,
    #[error("The AI service returned an unexpected answer")]
    BadResponse,
    #[error("Cancelled")]
    Cancelled,
    #[error("{0}")]
    Other(String),
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::NotFound => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::MissingKey => "missing_key",
            AppError::Unauthorized => "unauthorized",
            AppError::RateLimited => "rate_limited",
            AppError::Network => "network",
            AppError::BadResponse => "bad_response",
            AppError::Cancelled => "cancelled",
            AppError::Other(_) => "other",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
