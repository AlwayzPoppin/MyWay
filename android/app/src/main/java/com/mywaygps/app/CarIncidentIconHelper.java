package com.mywaygps.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

import androidx.car.app.model.CarIcon;
import androidx.core.graphics.drawable.IconCompat;

/**
 * Generates custom vector icon bitmaps and CarIcons for Android Auto markers,
 * detail screens, and alert lists matching the mobile MapLibre3DView / IncidentReporter designs.
 */
public class CarIncidentIconHelper {

    public static Bitmap createIncidentIconBitmap(String type, int sizePx) {
        Bitmap bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        float s = sizePx;
        float r = s * 0.22f;

        Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        strokePaint.setStyle(Paint.Style.STROKE);
        strokePaint.setStrokeWidth(s * 0.05f);
        strokePaint.setColor(Color.WHITE);

        Paint fgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        fgPaint.setColor(Color.WHITE);
        fgPaint.setStyle(Paint.Style.FILL);

        Paint fgStroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        fgStroke.setColor(Color.WHITE);
        fgStroke.setStyle(Paint.Style.STROKE);
        fgStroke.setStrokeCap(Paint.Cap.ROUND);
        fgStroke.setStrokeJoin(Paint.Join.ROUND);

        String norm = type != null ? type.toLowerCase() : "hazard";

        switch (norm) {
            case "traffic": {
                // Red badge (#ef4444) with 3-car queue
                bgPaint.setColor(Color.parseColor("#ef4444"));
                canvas.drawRoundRect(new RectF(0, 0, s, s), r, r, bgPaint);
                canvas.drawRoundRect(new RectF(s * 0.025f, s * 0.025f, s * 0.975f, s * 0.975f), r, r, strokePaint);

                // Draw 3 cars queued up: Lead car center-right, two trailing cars
                // Car 1 (lead - top center):
                drawMiniCar(canvas, s * 0.5f, s * 0.32f, s * 0.38f, s * 0.22f, fgPaint);
                // Car 2 (middle):
                drawMiniCar(canvas, s * 0.5f, s * 0.55f, s * 0.38f, s * 0.22f, fgPaint);
                // Car 3 (bottom):
                drawMiniCar(canvas, s * 0.5f, s * 0.78f, s * 0.38f, s * 0.22f, fgPaint);
                break;
            }

            case "stop_sign": {
                bgPaint.setColor(Color.parseColor("#dc2626"));
                android.graphics.Path stop = new android.graphics.Path();
                stop.moveTo(s * .3f, 0); stop.lineTo(s * .7f, 0);
                stop.lineTo(s, s * .3f); stop.lineTo(s, s * .7f);
                stop.lineTo(s * .7f, s); stop.lineTo(s * .3f, s);
                stop.lineTo(0, s * .7f); stop.lineTo(0, s * .3f); stop.close();
                canvas.drawPath(stop, bgPaint);
                fgPaint.setTextAlign(Paint.Align.CENTER);
                fgPaint.setTextSize(s * .26f);
                fgPaint.setFakeBoldText(true);
                canvas.drawText("STOP", s * .5f, s * .59f, fgPaint);
                break;
            }
            case "speed_bump": {
                // Dark slate/emerald badge with iconic yellow diamond (#facc15) and black raised-hump curve
                bgPaint.setColor(Color.parseColor("#1e293b"));
                canvas.drawRoundRect(new RectF(0, 0, s, s), r, r, bgPaint);
                canvas.drawRoundRect(new RectF(s * 0.025f, s * 0.025f, s * 0.975f, s * 0.975f), r, r, strokePaint);

                // Yellow Diamond rotated 45 degrees
                canvas.save();
                canvas.rotate(45, s * 0.5f, s * 0.5f);
                Paint diamondPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
                diamondPaint.setColor(Color.parseColor("#facc15"));
                float dSize = s * 0.32f;
                RectF diamondRect = new RectF(s * 0.5f - dSize, s * 0.5f - dSize, s * 0.5f + dSize, s * 0.5f + dSize);
                canvas.drawRoundRect(diamondRect, s * 0.06f, s * 0.06f, diamondPaint);

                Paint diamondBorder = new Paint(Paint.ANTI_ALIAS_FLAG);
                diamondBorder.setStyle(Paint.Style.STROKE);
                diamondBorder.setStrokeWidth(s * 0.04f);
                diamondBorder.setColor(Color.BLACK);
                canvas.drawRoundRect(diamondRect, s * 0.06f, s * 0.06f, diamondBorder);
                canvas.restore();

                // Black raised-hump curve in center
                Paint humpPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
                humpPaint.setStyle(Paint.Style.STROKE);
                humpPaint.setStrokeWidth(s * 0.09f);
                humpPaint.setColor(Color.BLACK);
                humpPaint.setStrokeCap(Paint.Cap.ROUND);

                Path humpPath = new Path();
                humpPath.moveTo(s * 0.25f, s * 0.58f);
                humpPath.cubicTo(s * 0.38f, s * 0.58f, s * 0.40f, s * 0.40f, s * 0.50f, s * 0.40f);
                humpPath.cubicTo(s * 0.60f, s * 0.40f, s * 0.62f, s * 0.58f, s * 0.75f, s * 0.58f);
                canvas.drawPath(humpPath, humpPaint);
                break;
            }

            case "safety_alert":
            case "alert":
            case "flooded_road": {
                // Sky/Cyan badge (#0ea5e9) with white water waves
                bgPaint.setColor(Color.parseColor("#0ea5e9"));
                canvas.drawRoundRect(new RectF(0, 0, s, s), r, r, bgPaint);
                canvas.drawRoundRect(new RectF(s * 0.025f, s * 0.025f, s * 0.975f, s * 0.975f), r, r, strokePaint);

                fgStroke.setStrokeWidth(s * 0.075f);
                // 3 Sine waves
                drawWave(canvas, s * 0.20f, s * 0.80f, s * 0.38f, s * 0.07f, fgStroke);
                drawWave(canvas, s * 0.20f, s * 0.80f, s * 0.54f, s * 0.07f, fgStroke);
                drawWave(canvas, s * 0.20f, s * 0.80f, s * 0.70f, s * 0.07f, fgStroke);
                break;
            }

            case "police": {
                // Blue badge (#3b82f6) with siren / badge
                bgPaint.setColor(Color.parseColor("#3b82f6"));
                canvas.drawRoundRect(new RectF(0, 0, s, s), r, r, bgPaint);
                canvas.drawRoundRect(new RectF(s * 0.025f, s * 0.025f, s * 0.975f, s * 0.975f), r, r, strokePaint);

                // Siren base & dome
                fgPaint.setColor(Color.WHITE);
                canvas.drawRect(s * 0.32f, s * 0.62f, s * 0.68f, s * 0.72f, fgPaint);
                RectF dome = new RectF(s * 0.35f, s * 0.35f, s * 0.65f, s * 0.65f);
                canvas.drawArc(dome, 180, 180, true, fgPaint);

                // Flashing light rays
                fgStroke.setStrokeWidth(s * 0.06f);
                canvas.drawLine(s * 0.5f, s * 0.22f, s * 0.5f, s * 0.30f, fgStroke);
                canvas.drawLine(s * 0.26f, s * 0.30f, s * 0.33f, s * 0.37f, fgStroke);
                canvas.drawLine(s * 0.74f, s * 0.30f, s * 0.67f, s * 0.37f, fgStroke);
                break;
            }

            case "construction": {
                // Orange badge (#f97316) with traffic cone
                bgPaint.setColor(Color.parseColor("#f97316"));
                canvas.drawRoundRect(new RectF(0, 0, s, s), r, r, bgPaint);
                canvas.drawRoundRect(new RectF(s * 0.025f, s * 0.025f, s * 0.975f, s * 0.975f), r, r, strokePaint);

                // Cone base
                canvas.drawRoundRect(new RectF(s * 0.25f, s * 0.72f, s * 0.75f, s * 0.82f), s * 0.04f, s * 0.04f, fgPaint);
                // Cone body
                Path cone = new Path();
                cone.moveTo(s * 0.5f, s * 0.24f);
                cone.lineTo(s * 0.68f, s * 0.72f);
                cone.lineTo(s * 0.32f, s * 0.72f);
                cone.close();
                canvas.drawPath(cone, fgPaint);

                // Orange stripe inside cone
                Paint coneStripe = new Paint(Paint.ANTI_ALIAS_FLAG);
                coneStripe.setColor(Color.parseColor("#f97316"));
                canvas.drawRect(s * 0.38f, s * 0.44f, s * 0.62f, s * 0.54f, coneStripe);
                break;
            }

            case "road_closed":
            case "closure": {
                // Rose/red badge (#e11d48) with Do Not Enter circle
                bgPaint.setColor(Color.parseColor("#e11d48"));
                canvas.drawRoundRect(new RectF(0, 0, s, s), r, r, bgPaint);
                canvas.drawRoundRect(new RectF(s * 0.025f, s * 0.025f, s * 0.975f, s * 0.975f), r, r, strokePaint);

                canvas.drawCircle(s * 0.5f, s * 0.5f, s * 0.28f, fgPaint);
                Paint barPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
                barPaint.setColor(Color.parseColor("#e11d48"));
                canvas.drawRoundRect(new RectF(s * 0.30f, s * 0.44f, s * 0.70f, s * 0.56f), s * 0.03f, s * 0.03f, barPaint);
                break;
            }

            case "shoulder": {
                // Purple badge (#a855f7) with vehicle on shoulder
                bgPaint.setColor(Color.parseColor("#a855f7"));
                canvas.drawRoundRect(new RectF(0, 0, s, s), r, r, bgPaint);
                canvas.drawRoundRect(new RectF(s * 0.025f, s * 0.025f, s * 0.975f, s * 0.975f), r, r, strokePaint);

                // Solid road lane dashed line
                fgStroke.setStrokeWidth(s * 0.05f);
                canvas.drawLine(s * 0.28f, s * 0.25f, s * 0.28f, s * 0.75f, fgStroke);

                // Tilted car on shoulder
                drawMiniCar(canvas, s * 0.58f, s * 0.5f, s * 0.36f, s * 0.38f, fgPaint);
                break;
            }

            case "signal_out": {
                // Amber/yellow badge (#ca8a04) with crossed-out signal
                bgPaint.setColor(Color.parseColor("#ca8a04"));
                canvas.drawRoundRect(new RectF(0, 0, s, s), r, r, bgPaint);
                canvas.drawRoundRect(new RectF(s * 0.025f, s * 0.025f, s * 0.975f, s * 0.975f), r, r, strokePaint);

                // Traffic light housing
                canvas.drawRoundRect(new RectF(s * 0.36f, s * 0.22f, s * 0.64f, s * 0.78f), s * 0.08f, s * 0.08f, fgPaint);
                Paint lightDark = new Paint(Paint.ANTI_ALIAS_FLAG);
                lightDark.setColor(Color.parseColor("#ca8a04"));
                canvas.drawCircle(s * 0.5f, s * 0.35f, s * 0.07f, lightDark);
                canvas.drawCircle(s * 0.5f, s * 0.50f, s * 0.07f, lightDark);
                canvas.drawCircle(s * 0.5f, s * 0.65f, s * 0.07f, lightDark);

                // Diagonal strike through
                Paint strike = new Paint(Paint.ANTI_ALIAS_FLAG);
                strike.setColor(Color.parseColor("#ef4444"));
                strike.setStrokeWidth(s * 0.06f);
                strike.setStrokeCap(Paint.Cap.ROUND);
                canvas.drawLine(s * 0.28f, s * 0.75f, s * 0.72f, s * 0.25f, strike);
                break;
            }

            case "hazard":
            default: {
                // Amber badge (#f59e0b) with warning triangle
                bgPaint.setColor(Color.parseColor("#f59e0b"));
                canvas.drawRoundRect(new RectF(0, 0, s, s), r, r, bgPaint);
                canvas.drawRoundRect(new RectF(s * 0.025f, s * 0.025f, s * 0.975f, s * 0.975f), r, r, strokePaint);

                // Warning triangle
                Path triangle = new Path();
                triangle.moveTo(s * 0.5f, s * 0.22f);
                triangle.lineTo(s * 0.78f, s * 0.76f);
                triangle.lineTo(s * 0.22f, s * 0.76f);
                triangle.close();
                canvas.drawPath(triangle, fgPaint);

                // Black exclamation point
                Paint excl = new Paint(Paint.ANTI_ALIAS_FLAG);
                excl.setColor(Color.parseColor("#f59e0b"));
                excl.setStrokeWidth(s * 0.07f);
                excl.setStrokeCap(Paint.Cap.ROUND);
                canvas.drawLine(s * 0.5f, s * 0.42f, s * 0.5f, s * 0.58f, excl);
                canvas.drawCircle(s * 0.5f, s * 0.68f, s * 0.04f, excl);
                break;
            }
        }

        return bitmap;
    }

    public static CarIcon getCarIcon(String type) {
        Bitmap bmp = createIncidentIconBitmap(type, 72);
        return new CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build();
    }

    private static void drawMiniCar(Canvas canvas, float cx, float cy, float w, float h, Paint paint) {
        float left = cx - w * 0.5f;
        float top = cy - h * 0.5f;
        float right = cx + w * 0.5f;
        float bottom = cy + h * 0.5f;
        float corner = h * 0.28f;

        // Vehicle body
        canvas.drawRoundRect(new RectF(left, top, right, bottom), corner, corner, paint);

        // Windshield cutout (dark)
        Paint dark = new Paint(Paint.ANTI_ALIAS_FLAG);
        dark.setColor(Color.parseColor("#1e293b"));
        canvas.drawRoundRect(new RectF(cx - w * 0.32f, cy - h * 0.28f, cx + w * 0.32f, cy + h * 0.15f), corner * 0.5f, corner * 0.5f, dark);
    }

    private static void drawWave(Canvas canvas, float startX, float endX, float y, float amp, Paint paint) {
        Path path = new Path();
        float midX = (startX + endX) * 0.5f;
        float q1 = (startX + midX) * 0.5f;
        float q2 = (midX + endX) * 0.5f;

        path.moveTo(startX, y);
        path.quadTo(q1, y - amp, midX, y);
        path.quadTo(q2, y + amp, endX, y);
        canvas.drawPath(path, paint);
    }
}
