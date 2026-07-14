package heatmap

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	db *pgxpool.Pool
}

type DayCount struct {
	Date         time.Time
	CreatedCount int64
	UpdatedCount int64
	TotalCount   int64
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (s *Service) Aggregate(ctx context.Context, userID uuid.UUID, from time.Time, to time.Time) ([]DayCount, error) {
	location := from.Location()
	fromDay := startOfDay(from, location)
	toDay := startOfDay(to, location)
	if toDay.Before(fromDay) {
		fromDay, toDay = toDay, fromDay
	}
	toExclusive := toDay.AddDate(0, 0, 1)

	created, err := s.countByDay(ctx, userID, fromDay, toExclusive, "created_at", location.String())
	if err != nil {
		return nil, err
	}
	updated, err := s.countByDay(ctx, userID, fromDay, toExclusive, "updated_at", location.String())
	if err != nil {
		return nil, err
	}

	return mergeDailyCounts(fromDay, toDay, created, updated), nil
}

func (s *Service) countByDay(ctx context.Context, userID uuid.UUID, from time.Time, toExclusive time.Time, field string, timezone string) (map[time.Time]int64, error) {
	additionalCondition := ""
	if field == "updated_at" {
		// A newly created note starts with updated_at equal to created_at. Do not
		// count that initial value as a separate update activity.
		additionalCondition = " AND updated_at > created_at"
	}
	rows, err := s.db.Query(ctx, `
		SELECT (`+field+` AT TIME ZONE $4)::date AS day, count(*)
		FROM notes
		WHERE user_id = $1
		  AND permanently_deleted_at IS NULL
		  AND `+field+` >= $2
		  AND `+field+` < $3
		  `+additionalCondition+`
		GROUP BY day
	`, userID, from.UTC(), toExclusive.UTC(), timezone)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[time.Time]int64)
	for rows.Next() {
		var day time.Time
		var count int64
		if err := rows.Scan(&day, &count); err != nil {
			return nil, err
		}
		result[calendarDay(day)] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func mergeDailyCounts(from time.Time, to time.Time, created map[time.Time]int64, updated map[time.Time]int64) []DayCount {
	fromDay := startOfDay(from, from.Location())
	toDay := startOfDay(to, from.Location())
	if toDay.Before(fromDay) {
		fromDay, toDay = toDay, fromDay
	}

	days := make([]DayCount, 0)
	for d := fromDay; !d.After(toDay); d = d.AddDate(0, 0, 1) {
		date := calendarDay(d)
		c := created[date]
		u := updated[date]
		days = append(days, DayCount{
			Date:         date,
			CreatedCount: c,
			UpdatedCount: u,
			TotalCount:   c + u,
		})
	}
	return days
}

func startOfDay(t time.Time, location *time.Location) time.Time {
	t = t.In(location)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, location)
}

func calendarDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}
