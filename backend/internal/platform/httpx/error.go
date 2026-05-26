package httpx

type ErrorResponse struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
}

func NewError(code, message, requestID string) ErrorResponse {
	return ErrorResponse{Error: ErrorBody{Code: code, Message: message, RequestID: requestID}}
}
