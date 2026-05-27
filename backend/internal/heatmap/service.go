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
	fromDay := startOfDayUTC(from)
	toDay := startOfDayUTC(to)
	if toDay.Before(fromDay) {
		fromDay, toDay = toDay, fromDay
	}
	toExclusive := toDay.AddDate(0, 0, 1)

	created, err := s.countByDay(ctx, userID, fromDay, toExclusive, "created_at")
	if err != nil {
		return nil, err
	}
	updated, err := s.countByDay(ctx, userID, fromDay, toExclusive, "updated_at")
	if err != nil {
		return nil, err
	}

	return mergeDailyCounts(fromDay, toDay, created, updated), nil
}

func (s *Service) countByDay(ctx context.Context, userID uuid.UUID, from time.Time, toExclusive time.Time, field string) (map[time.Time]int64, error) {
	rows, err := s.db.Query(ctx, `
		SELECT date_trunc('day', `+field+`)::date AS day, count(*)
		FROM notes
		WHERE user_id = $1
		  AND permanently_deleted_at IS NULL
		  AND `+field+` >= $2
		  AND `+field+` < $3
		GROUP BY day
	`, userID, from, toExclusive)
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
		result[startOfDayUTC(day)] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func mergeDailyCounts(from time.Time, to time.Time, created map[time.Time]int64, updated map[time.Time]int64) []DayCount {
	fromDay := startOfDayUTC(from)
	toDay := startOfDayUTC(to)
	if toDay.Before(fromDay) {
		fromDay, toDay = toDay, fromDay
	}

	days := make([]DayCount, 0, int(toDay.Sub(fromDay).Hours()/24)+1)
	for d := fromDay; !d.After(toDay); d = d.AddDate(0, 0, 1) {
		c := created[d]
		u := updated[d]
		days = append(days, DayCount{
			Date:         d,
			CreatedCount: c,
			UpdatedCount: u,
			TotalCount:   c + u,
		})
	}
	return days
}

func startOfDayUTC(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}
