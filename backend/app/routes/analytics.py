
import traceback
import warnings

import numpy as np
from scipy.stats import spearmanr
from sklearn.cluster import HDBSCAN
from sklearn.preprocessing import StandardScaler

from fastapi import APIRouter, Depends, HTTPException

from app.database import supabase
from app.auth import get_current_participant

from app.routes.history import (
    group_by,
    fetch_cv_observations,
    get_batch_session_performance,
)


router = APIRouter(
    prefix="/api/analytics",
    tags=["Advanced Analytics"]
)


# =====================================================
# KONFIGURASI FITUR COMPUTER VISION
# =====================================================

CV_LABELS = {
    "gaze": [
        "center",
        "down",
        "left",
        "right",
        "up",
    ],
    "head_motion": [
        "atas",
        "bawah",
        "depan",
        "kanan",
        "kiri",
    ],
    "expression": [
        "surprise",
        "fear",
        "disgust",
        "happy",
        "sad",
        "angry",
        "neutral",
    ],
}


# =====================================================
# MEMBANGUN DATA ANALITIK PER SESI
# =====================================================

def build_analytics_dataset(participant_id):
    """
    Menghasilkan satu baris data untuk setiap sesi wawancara.

    Skor performa menggunakan helper yang sama dengan
    endpoint riwayat wawancara.
    """

    # 1. Ambil sesi milik peserta yang sedang login.

    sessions_response = (
        supabase.table("interview_sessions")
        .select("*")
        .eq("participant_id", participant_id)
        .order("started_at", desc=True)
        .execute()
    )

    sessions = sessions_response.data or []

    if not sessions:
        return []

    session_ids = [
        item["id"] for item in sessions
    ]

    # 2. Ambil kriteria penilaian.

    criteria_response = (
        supabase.table("rubric_criteria")
        .select("*")
        .execute()
    )

    criteria_map = {
        item["id"]: item
        for item in (criteria_response.data or [])
    }

    # 3. Ambil pertanyaan sesi.

    questions_response = (
        supabase.table("session_questions")
        .select("id, session_id")
        .in_("session_id", session_ids)
        .execute()
    )

    questions = questions_response.data or []

    questions_by_session = group_by(
        questions,
        "session_id"
    )

    question_ids = [
        item["id"] for item in questions
    ]

    # 4. Ambil jawaban.

    answers = []

    if question_ids:
        answers_response = (
            supabase.table("answers")
            .select("id, session_question_id, created_at")
            .in_("session_question_id", question_ids)
            .execute()
        )

        answers = answers_response.data or []

    answers_by_question = group_by(
        answers,
        "session_question_id"
    )

    answer_ids = [
        item["id"] for item in answers
    ]

    # 5. Ambil skor rubrik lama.

    rubric_scores = []

    if answer_ids:
        rubric_response = (
            supabase.table("rubric_scores")
            .select("*")
            .in_("answer_id", answer_ids)
            .execute()
        )

        rubric_scores = rubric_response.data or []

    rubric_by_answer = group_by(
        rubric_scores,
        "answer_id"
    )

    # 6. Ambil evaluasi LLM.

    llm_evaluations = []

    if answer_ids:
        llm_response = (
            supabase.table("llm_evaluations")
            .select("*")
            .in_("answer_id", answer_ids)
            .execute()
        )

        llm_evaluations = llm_response.data or []

    evaluations_by_answer = {
        item["answer_id"]: item
        for item in llm_evaluations
    }

    evaluation_ids = [
        item["id"] for item in llm_evaluations
    ]

    # 7. Ambil skor evaluasi LLM.

    llm_scores = []

    if evaluation_ids:
        llm_scores_response = (
            supabase.table("llm_evaluation_scores")
            .select("*")
            .in_("evaluation_id", evaluation_ids)
            .execute()
        )

        llm_scores = llm_scores_response.data or []

    scores_by_evaluation = group_by(
        llm_scores,
        "evaluation_id"
    )

    # 8. Ambil seluruh observasi CV dengan pagination.

    observations = fetch_cv_observations(
        session_ids=session_ids,
        select_columns=(
            "id, session_id, timestamp_seconds, "
            "indicator_type, is_valid, predicted_label"
        )
    )

    cv_by_session = group_by(
        observations,
        "session_id"
    )

    # 9. Susun satu baris untuk setiap sesi.

    results = []

    for session in sessions:
        session_id = session["id"]

        session_questions = questions_by_session.get(
            session_id,
            []
        )

        has_answers = any(
            answers_by_question.get(question["id"])
            for question in session_questions
        )

        if not has_answers:
            continue

        performance = get_batch_session_performance(
            session,
            questions_by_session,
            answers_by_question,
            rubric_by_answer,
            evaluations_by_answer,
            scores_by_evaluation,
            criteria_map
        )

        score = performance.get("score")

        row = {
            "session_id": session_id,
            "started_at": performance.get("started_at"),
            "rubric_score": score,
        }

        # Ambil observasi CV yang valid saja.
        session_observations = cv_by_session.get(
            session_id,
            []
        )

        valid_by_indicator = {
            indicator: []
            for indicator in CV_LABELS
        }

        for observation in session_observations:
            indicator = observation.get("indicator_type")
            label = observation.get("predicted_label")

            if indicator not in CV_LABELS:
                continue

            if observation.get("is_valid") is not True:
                continue

            if label not in CV_LABELS[indicator]:
                continue

            valid_by_indicator[indicator].append(label)

        # Hitung proporsi setiap label dalam indikatornya.
        for indicator, labels in CV_LABELS.items():
            observed_labels = valid_by_indicator[indicator]
            total_valid = len(observed_labels)

            row[f"{indicator}_valid_count"] = total_valid

            for label in labels:
                feature_name = f"{indicator}_{label}_ratio"

                if total_valid == 0:
                    row[feature_name] = None
                else:
                    row[feature_name] = (
                        observed_labels.count(label) / total_valid
                    )

        results.append(row)

    return results


# =====================================================
# SPEARMAN CORRELATION
# =====================================================

@router.get("/spearman")
def get_spearman_analytics(
    participant=Depends(get_current_participant)
):
    try:
        dataset = build_analytics_dataset(
            participant["id"]
        )

        scored_sessions = [
            row for row in dataset
            if row["rubric_score"] is not None
        ]

        feature_names = [
            f"{indicator}_{label}_ratio"
            for indicator, labels in CV_LABELS.items()
            for label in labels
        ]

        correlations = []

        for feature in feature_names:
            paired_data = [
                (row["rubric_score"], row.get(feature))
                for row in scored_sessions
                if row.get(feature) is not None
            ]

            n = len(paired_data)

            if n < 3:
                correlations.append({
                    "feature": feature,
                    "rho": None,
                    "p_value": None,
                    "sample_size": n,
                    "status": "insufficient_data",
                })
                continue

            x = np.array(
                [item[0] for item in paired_data],
                dtype=float
            )

            y = np.array(
                [item[1] for item in paired_data],
                dtype=float
            )

            if np.unique(x).size < 2 or np.unique(y).size < 2:
                correlations.append({
                    "feature": feature,
                    "rho": None,
                    "p_value": None,
                    "sample_size": n,
                    "status": "constant_values",
                })
                continue

            with warnings.catch_warnings():
                warnings.simplefilter("ignore")

                result = spearmanr(x, y)

            correlations.append({
                "feature": feature,
                "rho": (
                    float(result.statistic)
                    if np.isfinite(result.statistic)
                    else None
                ),
                "p_value": (
                    float(result.pvalue)
                    if np.isfinite(result.pvalue)
                    else None
                ),
                "sample_size": n,
                "status": "calculated",
            })

        return {
            "success": True,
            "method": "Spearman Rank Correlation",
            "total_sessions": len(dataset),
            "scored_sessions": len(scored_sessions),
            "correlations": correlations,
            "interpretation_note": (
                "Korelasi menunjukkan hubungan monotonik, "
                "bukan hubungan sebab-akibat. Hasil bersifat "
                "eksploratif dan perlu mempertimbangkan ukuran sampel."
            ),
        }

    except Exception as error:
        traceback.print_exc()

        raise HTTPException(
            status_code=500,
            detail=f"Gagal menghitung Spearman: {str(error)}"
        )


# =====================================================
# HDBSCAN CLUSTERING
# =====================================================

@router.get("/clusters")
def get_hdbscan_analytics(
    participant=Depends(get_current_participant)
):
    try:
        dataset = build_analytics_dataset(
            participant["id"]
        )

        scored_sessions = [
            row for row in dataset
            if row["rubric_score"] is not None
        ]

        if len(scored_sessions) < 6:
            return {
                "success": True,
                "method": "HDBSCAN",
                "status": "insufficient_data",
                "total_sessions": len(dataset),
                "scored_sessions": len(scored_sessions),
                "message": (
                    "Minimal 6 sesi dengan skor performa "
                    "diperlukan untuk menjalankan clustering MVP."
                ),
                "clusters": [],
                "data": [],
            }

        # Kandidat fitur: skor performa dan proporsi CV.
        candidate_features = ["rubric_score"]

        all_cv_features = [
            f"{indicator}_{label}_ratio"
            for indicator, labels in CV_LABELS.items()
            for label in labels
        ]

        # Pilih fitur CV yang tersedia pada minimal 70% sesi.
        for feature in all_cv_features:
            available_count = sum(
                row.get(feature) is not None
                for row in scored_sessions
            )

            coverage = available_count / len(scored_sessions)

            if coverage >= 0.70:
                candidate_features.append(feature)

        # Gunakan complete cases. Tidak mengisi missing value
        # dengan angka nol karena nol memiliki makna proporsi.
        complete_rows = [
            row for row in scored_sessions
            if all(
                row.get(feature) is not None
                for feature in candidate_features
            )
        ]

        # Hilangkan fitur konstan agar tidak mengganggu clustering.
        matrix = np.array(
            [
                [row[feature] for feature in candidate_features]
                for row in complete_rows
            ],
            dtype=float
        )

        if len(complete_rows) > 0:
            variable_mask = np.var(matrix, axis=0) > 0

            selected_features = [
                feature
                for feature, keep in zip(
                    candidate_features,
                    variable_mask
                )
                if keep
            ]

            matrix = matrix[:, variable_mask]
        else:
            selected_features = []

        if len(complete_rows) < 6 or len(selected_features) < 2:
            return {
                "success": True,
                "method": "HDBSCAN",
                "status": "insufficient_complete_data",
                "total_sessions": len(dataset),
                "scored_sessions": len(scored_sessions),
                "complete_sessions": len(complete_rows),
                "features_used": selected_features,
                "message": (
                    "Data lengkap atau variasi fitur belum "
                    "mencukupi untuk clustering."
                ),
                "clusters": [],
                "data": [],
            }

        # Standardisasi fitur sebelum clustering.
        scaler = StandardScaler()
        scaled_data = scaler.fit_transform(matrix)

        model = HDBSCAN(
            min_cluster_size=3,
            min_samples=2,
            cluster_selection_method="eom",
        )

        labels = model.fit_predict(scaled_data)

        # Ringkasan cluster.
        cluster_ids = sorted(
            int(label)
            for label in set(labels)
            if label != -1
        )

        clusters = []

        for cluster_id in cluster_ids:
            members = [
                row
                for row, label in zip(complete_rows, labels)
                if label == cluster_id
            ]

            scores = [
                float(row["rubric_score"])
                for row in members
            ]

            clusters.append({
                "cluster": cluster_id,
                "total_sessions": len(members),
                "average_performance": float(
                    np.mean(scores)
                ),
            })

        # -1 adalah noise, bukan kategori performa rendah.
        output_data = []

        for row, label in zip(complete_rows, labels):
            output_data.append({
                "session_id": row["session_id"],
                "started_at": row["started_at"],
                "rubric_score": float(row["rubric_score"]),
                "cluster": int(label),
                "cluster_type": (
                    "noise" if label == -1 else "cluster"
                ),
            })

        noise_count = int(np.sum(labels == -1))

        return {
            "success": True,
            "method": "HDBSCAN",
            "status": "completed",
            "total_sessions": len(dataset),
            "scored_sessions": len(scored_sessions),
            "complete_sessions": len(complete_rows),
            "features_used": selected_features,
            "parameters": {
                "min_cluster_size": 3,
                "min_samples": 2,
                "cluster_selection_method": "eom",
            },
            "total_clusters": len(cluster_ids),
            "noise_count": noise_count,
            "clusters": clusters,
            "data": output_data,
            "interpretation_note": (
                "Label -1 menunjukkan observasi noise "
                "menurut algoritma HDBSCAN, bukan performa buruk."
            ),
        }

    except Exception as error:
        traceback.print_exc()

        raise HTTPException(
            status_code=500,
            detail=f"Gagal menjalankan HDBSCAN: {str(error)}"
        )
