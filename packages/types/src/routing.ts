export type RoutingOperator = 'EQUALS' | 'NOT_EQUALS' | 'IN' | 'NOT_IN' | 'CONTAINS';

export interface RoutingCondition {
  field: string;
  operator: RoutingOperator;
  value: string | string[];
}

export interface RoutingAction {
  type: 'ASSIGN_POOL' | 'ASSIGN_USER' | 'SET_PRIORITY' | 'SET_SUBSPECIALTY';
  value: string;
}

export interface RoutingRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  conditions: RoutingCondition[];
  actions: RoutingAction[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
