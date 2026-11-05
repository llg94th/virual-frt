/**
 * Mock Jira Simulator & Event-Driven Adapter (`MockJiraAdapter`)
 *
 * Implements `IJiraAdapter` for the Virtual FRT Office 2D Demo Pilot while
 * maintaining 100% compatibility with a post-pilot `RealJiraWebhookAdapter`.
 *
 * Key Workflow Rules:
 * 1. New Ticket / PM Assignment (`TODO` -> `IN_PROGRESS`):
 *    PM (`EMP-01`) or BA (`EMP-02`..`EMP-03`) carries the Spec document stack
 *    to the assigned Developer's desk.
 * 2. Code Complete (`IN_PROGRESS` -> `CODE_REVIEW`):
 *    Developer stands up and carries the PR document stack to their Squad Tech Lead
 *    (`EMP-04` Backend Lead, `EMP-05` Frontend Lead, `EMP-06` Mobile Lead).
 * 3. Review Approved (`CODE_REVIEW` -> `QA_TESTING` / `READY_FOR_DEPLOY`):
 *    Tech Lead carries the reviewed document stack to a QA Engineer (`EMP-25`..`EMP-28`)
 *    or DevOps Engineer (`EMP-29`..`EMP-30`).
 * 4. Bug Found / Rework (`QA_TESTING` / `CODE_REVIEW` -> `IN_PROGRESS`):
 *    QA or Tech Lead carries the bug report stack back to the original Developer's desk.
 * 5. Ticket Completed (`-> DONE`):
 *    The current holder (QA / DevOps / Dev) picks up the green DONE document stack
 *    (`isReturnToPM = true`) and walks back to the Project Manager's desk (`EMP-01`)
 *    for final sign-off and archival.
 */

import {
  CreateTicketInput,
  Employee,
  IJiraAdapter,
  JiraEventType,
  JiraTicket,
  JiraWebhookEvent,
  Role,
  TicketPriority,
  TicketStatus,
  TicketTransitionHistory,
  TicketType,
} from '../types/office';
import {
  EMPLOYEES,
  EMPLOYEE_BY_ID,
  PROJECT_MANAGER,
} from '../data/employees';

// ============================================================================
// 1. REALISTIC FRT ENGINEERING TICKET TEMPLATES
// ============================================================================

export interface TicketTemplate {
  summary: string;
  description: string;
  type: TicketType;
  priority: TicketPriority;
  storyPoints: number;
  category: 'BACKEND' | 'FRONTEND' | 'MOBILE' | 'DEVOPS';
}

export const FRT_TICKET_TEMPLATES: TicketTemplate[] = [
  {
    summary: 'Tối ưu API Giỏ hàng & Tính giá khuyến mãi',
    description:
      'Giảm latency API giỏ hàng xuống dưới 80ms khi áp dụng đồng thời nhiều chương trình khuyến mãi chuỗi nhà thuốc và FPT Shop.',
    type: 'STORY',
    priority: 'HIGH',
    storyPoints: 5,
    category: 'BACKEND',
  },
  {
    summary: 'Fix lỗi crash màn thanh toán iOS 18',
    description:
      'Xử lý lỗi null pointer khi chuyển đổi nhanh giữa phương thức Apple Pay và VietQR trên iOS.',
    type: 'BUG',
    priority: 'CRITICAL',
    storyPoints: 3,
    category: 'MOBILE',
  },
  {
    summary: 'Thiết kế UI Dashboard AI phân tích tồn kho',
    description:
      'Xây dựng giao diện trực quan hóa dự báo nhu cầu thuốc theo vùng miền và cảnh báo cận date theo thời gian thực.',
    type: 'STORY',
    priority: 'HIGH',
    storyPoints: 5,
    category: 'FRONTEND',
  },
  {
    summary: 'Đồng bộ tồn kho thuốc Long Châu thời gian thực',
    description:
      'Tối ưu Kafka consumer đồng bộ tồn kho giữa ERP và 1.600+ cửa hàng trên toàn quốc.',
    type: 'STORY',
    priority: 'CRITICAL',
    storyPoints: 8,
    category: 'BACKEND',
  },
  {
    summary: 'Tích hợp cổng thanh toán QR động tại quầy POS',
    description:
      'Hiển thị mã VietQR động trên màn hình phụ POS và tự động đối soát webhook ngân hàng trong 2 giây.',
    type: 'STORY',
    priority: 'HIGH',
    storyPoints: 5,
    category: 'BACKEND',
  },
  {
    summary: 'Tối ưu tốc độ tải trang chủ Web Omni-Channel (LCP < 1.5s)',
    description:
      'Áp dụng React Server Components, tối ưu bundle size và preload banner chiến dịch Flash Sale.',
    type: 'TASK',
    priority: 'MEDIUM',
    storyPoints: 3,
    category: 'FRONTEND',
  },
  {
    summary: 'Xây dựng tính năng Nhắc lịch uống thuốc trên Super App',
    description:
      'Hỗ trợ Push Notification cá nhân hóa theo đơn thuốc điện tử cho khách hàng.',
    type: 'STORY',
    priority: 'MEDIUM',
    storyPoints: 5,
    category: 'MOBILE',
  },
  {
    summary: 'Nâng cấp cụm Kubernetes Auto-scaling cho chiến dịch Mega Sale',
    description:
      'Cấu hình HPA/KEDA tự động scale pod Order & Payment chịu tải gấp 5 lần giờ cao điểm.',
    type: 'TASK',
    priority: 'HIGH',
    storyPoints: 5,
    category: 'DEVOPS',
  },
  {
    summary: 'Fix lỗi race-condition khi áp dụng Voucher giới hạn số lượng',
    description:
      'Sử dụng Redis Lua Script để đảm bảo tính nguyên tử khi hàng nghìn user bấm săn mã giảm giá cùng lúc.',
    type: 'HOTFIX',
    priority: 'CRITICAL',
    storyPoints: 5,
    category: 'BACKEND',
  },
  {
    summary: 'Xây dựng Portal quản trị chiến dịch Loyalty & Tích điểm',
    description:
      'Giao diện cấu hình quy tắc cộng điểm, đổi quà và phân hạng thành viên VIP.',
    type: 'STORY',
    priority: 'MEDIUM',
    storyPoints: 3,
    category: 'FRONTEND',
  },
  {
    summary: 'Tối ưu truy vấn Elasticsearch tìm kiếm thuốc theo hoạt chất',
    description:
      'Cải thiện độ chính xác gợi ý từ khóa tiếng Việt không dấu và biệt dược tương đương.',
    type: 'TASK',
    priority: 'HIGH',
    storyPoints: 5,
    category: 'BACKEND',
  },
  {
    summary: 'Cập nhật tính năng Quét mã vạch đơn thuốc bằng Camera Flutter',
    description:
      'Tăng tốc độ nhận diện QR/Barcode trên các dòng máy Android tầm trung trong điều kiện thiếu sáng.',
    type: 'STORY',
    priority: 'MEDIUM',
    storyPoints: 3,
    category: 'MOBILE',
  },
  {
    summary: 'Thiết lập Pipeline CI/CD Canary Release với ArgoCD',
    description:
      'Triển khai tự động kiểm tra metrics lỗi 5xx trên Prometheus trước khi rollout 100% traffic.',
    type: 'TASK',
    priority: 'HIGH',
    storyPoints: 5,
    category: 'DEVOPS',
  },
  {
    summary: 'Xây dựng bộ Visual Component Library chuẩn Design System 2.0',
    description:
      'Chuẩn hóa Button, Modal, DataTable, Form Validation dùng chung cho 5 dự án Web nội bộ.',
    type: 'STORY',
    priority: 'LOW',
    storyPoints: 3,
    category: 'FRONTEND',
  },
];

// ============================================================================
// 2. SPEECH BUBBLE DIALOGUES (VIETNAMESE DEV OFFICE HUMOR)
// ============================================================================

export interface HandoffSpeechPair {
  senderSpeech: string;
  receiverSpeech: string;
}

export function getSpeechBubblesForTransition(
  toStatus: TicketStatus,
  ticketKey: string,
  isBugReturn = false
): HandoffSpeechPair {
  if (isBugReturn) {
    return {
      senderSpeech: `🐞 Phát hiện bug ở ${ticketKey}! Nhờ dev kiểm tra lại nhé!`,
      receiverSpeech: `Ái chà, để mình debug và fix ngay ${ticketKey}!`,
    };
  }

  switch (toStatus) {
    case 'TODO':
      return {
        senderSpeech: `📋 Đặc tả ${ticketKey} mới từ PM, nhờ BA/Lead phân tích nhé!`,
        receiverSpeech: `Đã nhận tài liệu ${ticketKey}, mình lên spec ngay!`,
      };
    case 'IN_PROGRESS':
      return {
        senderSpeech: `📁 Giao hồ sơ ${ticketKey} nhé, ưu tiên trong Sprint này nha!`,
        receiverSpeech: `Rõ rồi! Nhận tài liệu ${ticketKey}, mình bắt đầu code luôn!`,
      };
    case 'CODE_REVIEW':
      return {
        senderSpeech: `🚀 Code xong ${ticketKey} rồi, nhờ Tech Lead review PR giúp!`,
        receiverSpeech: `Để mình soi kỹ kiến trúc & code của ${ticketKey} xem nào!`,
      };
    case 'QA_TESTING':
      return {
        senderSpeech: `🧪 PR ${ticketKey} đã duyệt! Chuyển hồ sơ sang QA kiểm thử nhé!`,
        receiverSpeech: `Nhận bản build ${ticketKey}! Để QA chạy bộ test case ngay!`,
      };
    case 'READY_FOR_DEPLOY':
      return {
        senderSpeech: `✅ ${ticketKey} đã pass QA! Nhờ DevOps chuẩn bị release nhé!`,
        receiverSpeech: `Ok! Đang đưa ${ticketKey} lên pipeline CI/CD production!`,
      };
    case 'DONE':
      return {
        senderSpeech: `🎉 Báo cáo PM: Ticket ${ticketKey} đã hoàn tất 100%, gửi sếp nghiệm thu!`,
        receiverSpeech: `Tuyệt vời! PM đóng dấu DONE cho ${ticketKey}, cảm ơn cả team!`,
      };
    default:
      return {
        senderSpeech: `📄 Bàn giao tài liệu ${ticketKey} sang bước tiếp theo!`,
        receiverSpeech: `Đã nhận hồ sơ ${ticketKey}!`,
      };
  }
}

// ============================================================================
// 3. HELPER FUNCTIONS FOR SMART WORKFLOW ROUTING
// ============================================================================

function computeStackSize(storyPoints: number, priority: TicketPriority): number {
  const base = Math.ceil(storyPoints / 2);
  const bonus = priority === 'CRITICAL' ? 2 : priority === 'HIGH' ? 1 : 0;
  return Math.max(1, Math.min(5, base + bonus));
}

function pickEmployeeWithLeastLoad(
  candidates: Employee[],
  activeTickets: JiraTicket[],
  excludeId?: string
): Employee {
  const filtered = candidates.filter((c) => c.id !== excludeId);
  const pool = filtered.length > 0 ? filtered : candidates;

  const loadByEmpId: Record<string, number> = {};
  for (const emp of pool) {
    loadByEmpId[emp.id] = 0;
  }
  for (const t of activeTickets) {
    if (t.status !== 'DONE' && loadByEmpId[t.assigneeId] !== undefined) {
      loadByEmpId[t.assigneeId] += 1;
    }
  }

  const sorted = [...pool].sort((a, b) => {
    const diff = (loadByEmpId[a.id] ?? 0) - (loadByEmpId[b.id] ?? 0);
    if (diff !== 0) return diff;
    return Math.random() - 0.5;
  });

  return sorted[0];
}

/**
 * Build a realistic multi-step workflow chain for a ticket based on its engineering category:
 * PM (EMP-01) -> BA (optional) -> Dev (BE/FE/Mobile/DevOps) -> Tech Lead (Code Review) -> QA (Testing) -> PM (DONE)
 */
export function buildWorkflowChainForCategory(
  category: 'BACKEND' | 'FRONTEND' | 'MOBILE' | 'DEVOPS',
  activeTickets: JiraTicket[],
  preferredDevId?: string
): {
  status: TicketStatus;
  employeeId: string;
  roleNote: string;
}[] {
  const pmId = PROJECT_MANAGER.id; // EMP-01
  const bas = EMPLOYEES.filter((e) => e.role === 'BA');
  const qas = EMPLOYEES.filter((e) => e.role === 'QA');
  const devops = EMPLOYEES.filter((e) => e.role === 'DEVOPS');

  const chosenBA = pickEmployeeWithLeastLoad(bas, activeTickets);
  const chosenQA = pickEmployeeWithLeastLoad(qas, activeTickets);

  let chosenDev: Employee;
  let chosenLeadId: string;

  if (preferredDevId && EMPLOYEE_BY_ID[preferredDevId]) {
    chosenDev = EMPLOYEE_BY_ID[preferredDevId];
    if (chosenDev.role === 'FRONTEND') {
      chosenLeadId = 'EMP-05';
    } else if (chosenDev.role === 'MOBILE') {
      chosenLeadId = 'EMP-06';
    } else {
      chosenLeadId = 'EMP-04';
    }
  } else if (category === 'FRONTEND') {
    const feDevs = EMPLOYEES.filter((e) => e.role === 'FRONTEND');
    chosenDev = pickEmployeeWithLeastLoad(feDevs, activeTickets);
    chosenLeadId = 'EMP-05'; // FE Tech Lead Vũ Hoàng Yến
  } else if (category === 'MOBILE') {
    const mobDevs = EMPLOYEES.filter((e) => e.role === 'MOBILE');
    chosenDev = pickEmployeeWithLeastLoad(mobDevs, activeTickets);
    chosenLeadId = 'EMP-06'; // Mobile Tech Lead Đặng Quốc Bảo
  } else if (category === 'DEVOPS') {
    chosenDev = pickEmployeeWithLeastLoad(devops, activeTickets);
    chosenLeadId = 'EMP-04'; // Backend/Arch Tech Lead Phạm Đức Anh
  } else {
    const beDevs = EMPLOYEES.filter((e) => e.role === 'BACKEND');
    chosenDev = pickEmployeeWithLeastLoad(beDevs, activeTickets);
    chosenLeadId = 'EMP-04'; // Backend Tech Lead Phạm Đức Anh
  }

  return [
    {
      status: 'TODO',
      employeeId: chosenBA.id,
      roleNote: 'BA phân tích đặc tả & nghiệm thu tiêu chí',
    },
    {
      status: 'IN_PROGRESS',
      employeeId: chosenDev.id,
      roleNote: 'Developer lập trình & viết Unit Test',
    },
    {
      status: 'CODE_REVIEW',
      employeeId: chosenLeadId,
      roleNote: 'Tech Lead review kiến trúc & duyệt Pull Request',
    },
    {
      status: 'QA_TESTING',
      employeeId: chosenQA.id,
      roleNote: 'QA/QC kiểm thử tích hợp & xác nhận chất lượng',
    },
    {
      status: 'DONE',
      employeeId: pmId,
      roleNote: 'Bàn giao chồng tài liệu nghiệm thu về bàn PM',
    },
  ];
}

// ============================================================================
// 4. MOCK JIRA ADAPTER IMPLEMENTATION
// ============================================================================

export class MockJiraAdapter implements IJiraAdapter {
  public readonly providerName = 'FRT Mock Jira Simulator (Pilot Demo)';
  public readonly mode = 'mock' as const;

  private connected = false;
  private tickets: Map<string, JiraTicket> = new Map();
  private listeners: Set<(event: JiraWebhookEvent) => void> = new Set();
  private ticketCounter = 100;
  private templateCursor = 0;

  constructor() {
    this.seedInitialTickets();
  }

  private nextTicketNumber(): number {
    this.ticketCounter += 1;
    return this.ticketCounter;
  }

  private seedInitialTickets(): void {
    this.tickets.clear();
    this.ticketCounter = 100;

    // Seed 7 realistic initial tickets across different stages so the board and office look immediately alive
    const initialConfigs: {
      templateIdx: number;
      status: TicketStatus;
      stepIdx: number;
      devId: string;
    }[] = [
      { templateIdx: 0, status: 'IN_PROGRESS', stepIdx: 1, devId: 'EMP-07' }, // FRT-101: BE Văn Hùng
      { templateIdx: 1, status: 'IN_PROGRESS', stepIdx: 1, devId: 'EMP-21' }, // FRT-102: Mob Nhật Minh
      { templateIdx: 2, status: 'CODE_REVIEW', stepIdx: 2, devId: 'EMP-15' }, // FRT-103: Review at FE Lead EMP-05
      { templateIdx: 3, status: 'QA_TESTING', stepIdx: 3, devId: 'EMP-08' },  // FRT-104: Testing at QA EMP-25
      { templateIdx: 4, status: 'IN_PROGRESS', stepIdx: 1, devId: 'EMP-10' }, // FRT-105: BE Quang Huy
      { templateIdx: 5, status: 'TODO', stepIdx: 0, devId: 'EMP-16' },        // FRT-106: At BA EMP-02
      { templateIdx: 6, status: 'QA_TESTING', stepIdx: 3, devId: 'EMP-23' },  // FRT-107: Testing at QA EMP-26
    ];

    this.templateCursor = initialConfigs.length;

    initialConfigs.forEach((cfg, index) => {
      const tpl = FRT_TICKET_TEMPLATES[cfg.templateIdx % FRT_TICKET_TEMPLATES.length];
      const num = this.nextTicketNumber();
      const id = `TICKET-${num}`;
      const key = `FRT-${num}`;
      const chain = buildWorkflowChainForCategory(
        tpl.category,
        Array.from(this.tickets.values()),
        cfg.devId
      );

      // Ensure varied QA and BA assignments for initial seeds
      if (index === 3) chain[3].employeeId = 'EMP-25';
      if (index === 6) chain[3].employeeId = 'EMP-26';
      if (index === 5) chain[0].employeeId = 'EMP-02';

      const currentStep = chain[cfg.stepIdx] ?? chain[0];
      const prevStep = cfg.stepIdx > 0 ? chain[cfg.stepIdx - 1] : null;
      const nowIso = new Date(Date.now() - (10 - index) * 60_000).toISOString();

      const ticket: JiraTicket = {
        id,
        key,
        summary: tpl.summary,
        description: tpl.description,
        type: tpl.type,
        priority: tpl.priority,
        status: cfg.status,
        reporterId: PROJECT_MANAGER.id,
        assigneeId: currentStep.employeeId,
        previousAssigneeId: prevStep ? prevStep.employeeId : PROJECT_MANAGER.id,
        storyPoints: tpl.storyPoints,
        documentStackSize: computeStackSize(tpl.storyPoints, tpl.priority),
        workflowChain: chain,
        currentStepIndex: cfg.stepIdx,
        deliveredToPM: cfg.status === 'DONE',
        createdAt: nowIso,
        updatedAt: nowIso,
        history: [
          {
            id: `HIST-${key}-0`,
            timestamp: nowIso,
            fromStatus: null,
            toStatus: cfg.status,
            fromEmployeeId: prevStep ? prevStep.employeeId : PROJECT_MANAGER.id,
            toEmployeeId: currentStep.employeeId,
            comment: `Khởi tạo ticket ${key}: ${currentStep.roleNote}`,
          },
        ],
      };

      this.tickets.set(ticket.id, ticket);
    });
  }

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public disconnect(): void {
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async getInitialTickets(): Promise<JiraTicket[]> {
    return Array.from(this.tickets.values()).map((t) => ({
      ...t,
      workflowChain: [...t.workflowChain],
      history: [...t.history],
    }));
  }

  public getTicketsSnapshot(): JiraTicket[] {
    return Array.from(this.tickets.values());
  }

  public getTicketByIdOrKey(idOrKey: string): JiraTicket | undefined {
    const direct = this.tickets.get(idOrKey);
    if (direct) return direct;
    return Array.from(this.tickets.values()).find((t) => t.key === idOrKey);
  }

  public onTicketEvent(listener: (event: JiraWebhookEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitEvent(event: JiraWebhookEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Create a new Jira Ticket.
   * Starts at PM (`EMP-01`) and immediately dispatches a document handoff to the initial assignee
   * (either a Developer in `IN_PROGRESS` or BA in `TODO`).
   */
  public async createTicket(input: CreateTicketInput): Promise<JiraTicket> {
    const num = this.nextTicketNumber();
    const id = `TICKET-${num}`;
    const key = `FRT-${num}`;

    const type: TicketType = input.type ?? 'STORY';
    const priority: TicketPriority = input.priority ?? 'HIGH';
    const storyPoints = input.storyPoints ?? 5;

    // Infer category from initialAssigneeId or summary keywords
    let category: 'BACKEND' | 'FRONTEND' | 'MOBILE' | 'DEVOPS' = 'BACKEND';
    const summaryLower = input.summary.toLowerCase();
    if (
      summaryLower.includes('ios') ||
      summaryLower.includes('android') ||
      summaryLower.includes('mobile') ||
      summaryLower.includes('app') ||
      summaryLower.includes('flutter')
    ) {
      category = 'MOBILE';
    } else if (
      summaryLower.includes('ui') ||
      summaryLower.includes('ux') ||
      summaryLower.includes('dashboard') ||
      summaryLower.includes('web') ||
      summaryLower.includes('portal') ||
      summaryLower.includes('trang chủ')
    ) {
      category = 'FRONTEND';
    } else if (
      summaryLower.includes('kubernetes') ||
      summaryLower.includes('ci/cd') ||
      summaryLower.includes('infra') ||
      summaryLower.includes('cloud') ||
      summaryLower.includes('deploy')
    ) {
      category = 'DEVOPS';
    }

    const activeList = Array.from(this.tickets.values());
    const chain = buildWorkflowChainForCategory(
      category,
      activeList,
      input.initialAssigneeId
    );

    // Determine whether PM assigns directly to Dev (IN_PROGRESS) or BA (TODO)
    let startStepIndex = 1; // Default: PM assigns directly to Dev so viewer sees PM -> Dev walk immediately!
    if (input.initialAssigneeId) {
      const assignedEmp = EMPLOYEE_BY_ID[input.initialAssigneeId];
      if (assignedEmp?.role === 'BA') {
        chain[0].employeeId = assignedEmp.id;
        startStepIndex = 0;
      } else if (assignedEmp) {
        chain[1].employeeId = assignedEmp.id;
        startStepIndex = 1;
      }
    }

    const targetStep = chain[startStepIndex];
    const nowIso = new Date().toISOString();
    const fromEmp = PROJECT_MANAGER;
    const toEmp = EMPLOYEE_BY_ID[targetStep.employeeId] ?? PROJECT_MANAGER;

    const historyEntry: TicketTransitionHistory = {
      id: `HIST-${key}-${Date.now()}`,
      timestamp: nowIso,
      fromStatus: 'TODO',
      toStatus: targetStep.status,
      fromEmployeeId: fromEmp.id,
      toEmployeeId: toEmp.id,
      comment: `${fromEmp.displayName} tạo mới và giao hồ sơ ${key} cho ${toEmp.displayName}`,
    };

    const newTicket: JiraTicket = {
      id,
      key,
      summary: input.summary,
      description:
        input.description ??
        `Ticket thuộc Sprint hiện tại của phòng lập trình FRT (${key}).`,
      type,
      priority,
      status: targetStep.status,
      reporterId: PROJECT_MANAGER.id,
      assigneeId: toEmp.id,
      previousAssigneeId: fromEmp.id,
      storyPoints,
      documentStackSize: computeStackSize(storyPoints, priority),
      workflowChain: chain,
      currentStepIndex: startStepIndex,
      deliveredToPM: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      history: [historyEntry],
    };

    this.tickets.set(newTicket.id, newTicket);

    const webhookEvent: JiraWebhookEvent = {
      eventId: `EVT-${key}-${Date.now()}`,
      eventType: 'TICKET_CREATED',
      timestamp: nowIso,
      ticket: { ...newTicket },
      fromEmployeeId: fromEmp.id,
      toEmployeeId: toEmp.id,
      fromStatus: 'TODO',
      toStatus: targetStep.status,
      isReturnToPM: false,
      summaryMessage: `${fromEmp.displayName} cầm chồng tài liệu ${key} ("${newTicket.summary}") sang bàn ${toEmp.displayName}`,
    };

    this.emitEvent(webhookEvent);
    return newTicket;
  }

  /**
   * Generate a realistic FRT engineering ticket with 1 click
   */
  public async createRandomTicket(
    preferredCategory?: 'BACKEND' | 'FRONTEND' | 'MOBILE' | 'DEVOPS'
  ): Promise<JiraTicket> {
    let tpl: TicketTemplate;
    if (preferredCategory) {
      const matching = FRT_TICKET_TEMPLATES.filter(
        (t) => t.category === preferredCategory
      );
      tpl =
        matching[this.templateCursor % matching.length] ??
        FRT_TICKET_TEMPLATES[this.templateCursor % FRT_TICKET_TEMPLATES.length];
    } else {
      tpl =
        FRT_TICKET_TEMPLATES[this.templateCursor % FRT_TICKET_TEMPLATES.length];
    }
    this.templateCursor += 1;

    return this.createTicket({
      summary: tpl.summary,
      description: tpl.description,
      type: tpl.type,
      priority: tpl.priority,
      storyPoints: tpl.storyPoints,
    });
  }

  /**
   * Transition a ticket to `nextStatus` and hand over the document stack to `nextAssigneeId`.
   * Rule: When `nextStatus === 'DONE'`, the recipient is ALWAYS Project Manager (`EMP-01`)
   * and `isReturnToPM` is set to `true`.
   */
  public async transitionTicket(
    ticketIdOrKey: string,
    nextStatus: TicketStatus,
    nextAssigneeId: string,
    comment?: string,
    explicitFromEmployeeId?: string
  ): Promise<JiraTicket> {
    const existing = this.getTicketByIdOrKey(ticketIdOrKey);
    if (!existing) {
      throw new Error(`Không tìm thấy Ticket: ${ticketIdOrKey}`);
    }

    const fromEmployeeId =
      explicitFromEmployeeId && EMPLOYEE_BY_ID[explicitFromEmployeeId]
        ? explicitFromEmployeeId
        : existing.assigneeId;
    const prevStatus = existing.status;
    const isReturnToPM = nextStatus === 'DONE';

    // Enforce PM destination when status is DONE
    const resolvedTargetEmployeeId = isReturnToPM
      ? PROJECT_MANAGER.id
      : EMPLOYEE_BY_ID[nextAssigneeId]
      ? nextAssigneeId
      : this.resolveDefaultAssigneeForStatus(existing, nextStatus);

    const fromEmp = EMPLOYEE_BY_ID[fromEmployeeId] ?? PROJECT_MANAGER;
    const toEmp = EMPLOYEE_BY_ID[resolvedTargetEmployeeId] ?? PROJECT_MANAGER;
    const nowIso = new Date().toISOString();

    // Update step index in workflowChain if it matches
    const matchedStepIdx = existing.workflowChain.findIndex(
      (step) => step.status === nextStatus
    );
    const updatedStepIndex =
      matchedStepIdx >= 0 ? matchedStepIdx : existing.currentStepIndex;

    const actionMessage = isReturnToPM
      ? `🎉 ${fromEmp.displayName} hoàn tất ${existing.key} (DONE) và mang chồng tài liệu nghiệm thu về bàn ${toEmp.displayName}!`
      : comment
      ? comment
      : `${fromEmp.displayName} mang chồng tài liệu ${existing.key} sang bàn ${toEmp.displayName} (${nextStatus})`;

    const newHistoryEntry: TicketTransitionHistory = {
      id: `HIST-${existing.key}-${Date.now()}`,
      timestamp: nowIso,
      fromStatus: prevStatus,
      toStatus: nextStatus,
      fromEmployeeId: fromEmp.id,
      toEmployeeId: toEmp.id,
      comment: actionMessage,
    };

    const updatedTicket: JiraTicket = {
      ...existing,
      status: nextStatus,
      previousAssigneeId: fromEmp.id,
      assigneeId: toEmp.id,
      currentStepIndex: updatedStepIndex,
      deliveredToPM: isReturnToPM ? false : existing.deliveredToPM,
      updatedAt: nowIso,
      history: [...existing.history, newHistoryEntry],
    };

    this.tickets.set(updatedTicket.id, updatedTicket);

    const eventType: JiraEventType = isReturnToPM
      ? 'TICKET_DONE'
      : 'TICKET_TRANSITIONED';

    const webhookEvent: JiraWebhookEvent = {
      eventId: `EVT-${updatedTicket.key}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      eventType,
      timestamp: nowIso,
      ticket: { ...updatedTicket },
      fromEmployeeId: fromEmp.id,
      toEmployeeId: toEmp.id,
      fromStatus: prevStatus,
      toStatus: nextStatus,
      isReturnToPM,
      summaryMessage: actionMessage,
    };

    this.emitEvent(webhookEvent);
    return updatedTicket;
  }

  /**
   * Reject a ticket from QA_TESTING or CODE_REVIEW back to the original Developer (`IN_PROGRESS`)
   * because a bug or issue was found.
   */
  public async rejectTicketWithBug(
    ticketIdOrKey: string,
    bugReason?: string
  ): Promise<JiraWebhookEvent | null> {
    const ticket = this.getTicketByIdOrKey(ticketIdOrKey);
    if (!ticket || ticket.status === 'DONE') return null;

    // Find the developer step in the workflowChain
    const devStep = ticket.workflowChain.find(
      (s) => s.status === 'IN_PROGRESS'
    );
    const targetDevId =
      devStep?.employeeId ??
      ticket.previousAssigneeId ??
      'EMP-07';

    const fromEmp = EMPLOYEE_BY_ID[ticket.assigneeId] ?? PROJECT_MANAGER;
    const toEmp = EMPLOYEE_BY_ID[targetDevId] ?? PROJECT_MANAGER;

    const note =
      bugReason ??
      `🐞 ${fromEmp.displayName} phát hiện bug trên ${ticket.key}, cầm hồ sơ trả lại bàn ${toEmp.displayName} để fix!`;

    const updated = await this.transitionTicket(
      ticket.id,
      'IN_PROGRESS',
      toEmp.id,
      note
    );

    return {
      eventId: `EVT-BUG-${updated.key}-${Date.now()}`,
      eventType: 'TICKET_TRANSITIONED',
      timestamp: updated.updatedAt,
      ticket: updated,
      fromEmployeeId: fromEmp.id,
      toEmployeeId: toEmp.id,
      fromStatus: ticket.status,
      toStatus: 'IN_PROGRESS',
      isReturnToPM: false,
      summaryMessage: note,
    };
  }

  /**
   * Advance a ticket (or a well-chosen active ticket) to its next logical workflow stage.
   * Used both by the user clicking "Bước tiếp ➔" on a ticket card and by the Auto-Pilot timer.
   */
  public async advanceTicketWorkflow(
    ticketIdOrKey?: string,
    busyEmployeeIds?: Set<string>
  ): Promise<JiraWebhookEvent | null> {
    let targetTicket: JiraTicket | undefined;

    if (ticketIdOrKey) {
      targetTicket = this.getTicketByIdOrKey(ticketIdOrKey);
    } else {
      // Pick an active non-DONE ticket whose current holder is not currently walking
      const activeCandidates = Array.from(this.tickets.values()).filter(
        (t) =>
          t.status !== 'DONE' &&
          (!busyEmployeeIds || !busyEmployeeIds.has(t.assigneeId))
      );

      if (activeCandidates.length === 0) {
        // If too few active tickets exist, auto-spawn a fresh ticket from PM
        const nonDoneCount = Array.from(this.tickets.values()).filter(
          (t) => t.status !== 'DONE'
        ).length;
        if (nonDoneCount < 5) {
          await this.createRandomTicket();
        }
        return null;
      }

      // Prioritize tickets that haven't been updated recently
      activeCandidates.sort(
        (a, b) =>
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      );
      targetTicket = activeCandidates[0];
    }

    if (!targetTicket || targetTicket.status === 'DONE') {
      return null;
    }

    // Small 12% chance when auto-advancing from QA_TESTING (without explicit user ticketId) to simulate a bug return
    if (
      !ticketIdOrKey &&
      targetTicket.status === 'QA_TESTING' &&
      Math.random() < 0.12
    ) {
      return this.rejectTicketWithBug(targetTicket.id);
    }

    const nextStepIndex = targetTicket.currentStepIndex + 1;
    let nextStatus: TicketStatus;
    let nextAssigneeId: string;

    if (nextStepIndex < targetTicket.workflowChain.length) {
      const nextStep = targetTicket.workflowChain[nextStepIndex];
      nextStatus = nextStep.status;
      nextAssigneeId = nextStep.employeeId;
    } else {
      // Fallback progression based on current status
      nextStatus = this.getNextLogicalStatus(targetTicket.status);
      nextAssigneeId = this.resolveDefaultAssigneeForStatus(
        targetTicket,
        nextStatus
      );
    }

    const prevStatus = targetTicket.status;
    const fromEmpId = targetTicket.assigneeId;
    const updated = await this.transitionTicket(
      targetTicket.id,
      nextStatus,
      nextAssigneeId
    );

    return {
      eventId: `EVT-ADV-${updated.key}-${Date.now()}`,
      eventType: nextStatus === 'DONE' ? 'TICKET_DONE' : 'TICKET_TRANSITIONED',
      timestamp: updated.updatedAt,
      ticket: updated,
      fromEmployeeId: fromEmpId,
      toEmployeeId: updated.assigneeId,
      fromStatus: prevStatus,
      toStatus: nextStatus,
      isReturnToPM: nextStatus === 'DONE',
      summaryMessage:
        updated.history[updated.history.length - 1]?.comment ?? '',
    };
  }

  private getNextLogicalStatus(current: TicketStatus): TicketStatus {
    switch (current) {
      case 'BACKLOG':
      case 'TODO':
        return 'IN_PROGRESS';
      case 'IN_PROGRESS':
        return 'CODE_REVIEW';
      case 'CODE_REVIEW':
        return 'QA_TESTING';
      case 'QA_TESTING':
      case 'READY_FOR_DEPLOY':
        return 'DONE';
      case 'DONE':
      default:
        return 'DONE';
    }
  }

  public resolveDefaultAssigneeForStatus(
    ticket: JiraTicket,
    nextStatus: TicketStatus
  ): string {
    if (nextStatus === 'DONE') {
      return PROJECT_MANAGER.id; // Always return to PM EMP-01
    }

    const chainMatch = ticket.workflowChain.find(
      (s) => s.status === nextStatus
    );
    if (chainMatch && EMPLOYEE_BY_ID[chainMatch.employeeId]) {
      return chainMatch.employeeId;
    }

    const activeList = Array.from(this.tickets.values());
    const currentEmp = EMPLOYEE_BY_ID[ticket.assigneeId];

    switch (nextStatus) {
      case 'TODO': {
        const bas = EMPLOYEES.filter((e) => e.role === 'BA');
        return pickEmployeeWithLeastLoad(bas, activeList, ticket.assigneeId).id;
      }
      case 'IN_PROGRESS': {
        const devs = EMPLOYEES.filter(
          (e) =>
            e.role === 'BACKEND' ||
            e.role === 'FRONTEND' ||
            e.role === 'MOBILE'
        );
        return pickEmployeeWithLeastLoad(devs, activeList, ticket.assigneeId).id;
      }
      case 'CODE_REVIEW': {
        if (currentEmp?.role === 'FRONTEND') return 'EMP-05';
        if (currentEmp?.role === 'MOBILE') return 'EMP-06';
        return 'EMP-04';
      }
      case 'QA_TESTING': {
        const qas = EMPLOYEES.filter((e) => e.role === 'QA');
        return pickEmployeeWithLeastLoad(qas, activeList, ticket.assigneeId).id;
      }
      case 'READY_FOR_DEPLOY': {
        const ops = EMPLOYEES.filter((e) => e.role === 'DEVOPS');
        return pickEmployeeWithLeastLoad(ops, activeList, ticket.assigneeId).id;
      }
      default:
        return PROJECT_MANAGER.id;
    }
  }

  /**
   * Mark a ticket's physical document stack as delivered on the PM's desk
   */
  public markTicketDeliveredToPM(ticketIdOrKey: string): void {
    const ticket = this.getTicketByIdOrKey(ticketIdOrKey);
    if (ticket) {
      ticket.deliveredToPM = true;
      ticket.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Reset all tickets to initial demo state
   */
  public reset(): JiraTicket[] {
    this.seedInitialTickets();
    return Array.from(this.tickets.values());
  }
}

/** Singleton instance for convenient import across the application */
export const mockJiraAdapter = new MockJiraAdapter();
