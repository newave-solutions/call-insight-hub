export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      call_log_themes: {
        Row: {
          call_log_id: string
          created_at: string
          customer_id: string | null
          entity_name: string | null
          entity_type: string | null
          id: string
          is_cancel_driver: boolean
          occurred_at: string
          quote: string | null
          severity: string
          theme: string
          user_id: string
        }
        Insert: {
          call_log_id: string
          created_at?: string
          customer_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          is_cancel_driver?: boolean
          occurred_at?: string
          quote?: string | null
          severity?: string
          theme: string
          user_id: string
        }
        Update: {
          call_log_id?: string
          created_at?: string
          customer_id?: string | null
          entity_name?: string | null
          entity_type?: string | null
          id?: string
          is_cancel_driver?: boolean
          occurred_at?: string
          quote?: string | null
          severity?: string
          theme?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_log_themes_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          account_label: string | null
          agreement_length_months: number | null
          call_date: string | null
          categories: string[]
          category: string
          coupon: string | null
          coupon_amount: number | null
          coupon_value: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          date_source: string
          escalated_to_cem: boolean
          follow_up_needed: boolean
          follow_up_notes: string | null
          id: string
          key_points: Json | null
          lead_sold: boolean
          needs_review: boolean
          payment_amount: number | null
          price_per_service: number | null
          raw_notes: string
          refund_amount: number | null
          sentiment: string | null
          service_name: string | null
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_label?: string | null
          agreement_length_months?: number | null
          call_date?: string | null
          categories?: string[]
          category: string
          coupon?: string | null
          coupon_amount?: number | null
          coupon_value?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          date_source?: string
          escalated_to_cem?: boolean
          follow_up_needed?: boolean
          follow_up_notes?: string | null
          id?: string
          key_points?: Json | null
          lead_sold?: boolean
          needs_review?: boolean
          payment_amount?: number | null
          price_per_service?: number | null
          raw_notes: string
          refund_amount?: number | null
          sentiment?: string | null
          service_name?: string | null
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_label?: string | null
          agreement_length_months?: number | null
          call_date?: string | null
          categories?: string[]
          category?: string
          coupon?: string | null
          coupon_amount?: number | null
          coupon_value?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          date_source?: string
          escalated_to_cem?: boolean
          follow_up_needed?: boolean
          follow_up_notes?: string | null
          id?: string
          key_points?: Json | null
          lead_sold?: boolean
          needs_review?: boolean
          payment_amount?: number | null
          price_per_service?: number | null
          raw_notes?: string
          refund_amount?: number | null
          sentiment?: string | null
          service_name?: string | null
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pattern_alerts: {
        Row: {
          alert_key: string
          count: number
          created_at: string
          id: string
          kind: string
          payload: Json
          status: string
          updated_at: string
          user_id: string
          window_start: string
        }
        Insert: {
          alert_key: string
          count?: number
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          status?: string
          updated_at?: string
          user_id: string
          window_start: string
        }
        Update: {
          alert_key?: string
          count?: number
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          status?: string
          updated_at?: string
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
